mod cache;
mod rules;

use axum::{
    Router,
    routing::{get, post},
    Json,
    extract::State,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Instant;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use cache::L1Cache;
use rules::{is_complex, RouteStats};

#[derive(Clone)]
pub struct AppState {
    pub cache: Arc<L1Cache>,
    pub stats: Arc<RouteStats>,
    pub intent_url: String,
    pub default_simple_model: String,
    pub default_complex_model: String,
}

#[derive(Deserialize)]
pub struct RouteRequest {
    pub prompt: String,
    pub session_key: Option<String>,
}

#[derive(Serialize)]
pub struct RouteResponse {
    pub model: String,
    pub provider: String,
    pub layer: String,
    pub cache_hit: bool,
    pub latency_ms: f64,
}

#[derive(Serialize)]
pub struct StatsResponse {
    pub total: u64,
    pub cache_hits: u64,
    pub hit_rate: f64,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let redis_url = std::env::var("REDIS_URL")
        .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    let intent_url = std::env::var("INTENT_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:8000".to_string());
    let l1_ttl: u64 = std::env::var("L1_TTL_SECS")
        .unwrap_or_else(|_| "3600".to_string())
        .parse().unwrap_or(3600);
    let default_simple_model = std::env::var("SIMPLE_MODEL")
        .unwrap_or_else(|_| "qwen2.5:7b".to_string());
    let default_complex_model = std::env::var("COMPLEX_MODEL")
        .unwrap_or_else(|_| "claude-sonnet-4-6".to_string());

    let cache = Arc::new(L1Cache::new(&redis_url, l1_ttl).await?);
    let stats = Arc::new(RouteStats::new());

    let state = Arc::new(AppState {
        cache,
        stats,
        intent_url,
        default_simple_model,
        default_complex_model,
    });

    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/route", post(route_handler))
        .route("/stats", get(stats_handler))
        .with_state(state)
        .layer(tower_http::cors::CorsLayer::permissive());

    let addr = "0.0.0.0:3001";
    tracing::info!("router-rust listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health_handler() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok", "service": "clawgate-router" }))
}

async fn route_handler(
    State(state): State<Arc<AppState>>,
    Json(req): Json<RouteRequest>,
) -> Json<RouteResponse> {
    let start = Instant::now();
    state.stats.incr_total();

    // L1: Hash 缓存查找
    if let Ok(Some(cached_model)) = state.cache.get(&req.prompt).await {
        state.stats.incr_hit();
        let latency_ms = start.elapsed().as_secs_f64() * 1000.0;
        return Json(RouteResponse {
            model: cached_model.clone(),
            provider: infer_provider(&cached_model),
            layer: "L1".to_string(),
            cache_hit: true,
            latency_ms,
        });
    }

    // L2/L3: 调用 Python intent 服务
    let (model, layer) = call_intent(&state.intent_url, &req.prompt, &state.default_simple_model, &state.default_complex_model).await;

    // 写入 L1 缓存
    let _ = state.cache.set(&req.prompt, &model).await;

    let latency_ms = start.elapsed().as_secs_f64() * 1000.0;
    let provider = infer_provider(&model);
    Json(RouteResponse {
        model,
        provider,
        layer,
        cache_hit: false,
        latency_ms,
    })
}

async fn stats_handler(State(state): State<Arc<AppState>>) -> Json<StatsResponse> {
    let total = state.stats.total();
    let hits = state.stats.hits();
    let hit_rate = if total > 0 { hits as f64 / total as f64 } else { 0.0 };
    Json(StatsResponse { total, cache_hits: hits, hit_rate })
}

async fn call_intent(intent_url: &str, prompt: &str, simple_model: &str, complex_model: &str) -> (String, String) {
    let client = reqwest::Client::new();
    let body = serde_json::json!({ "prompt": prompt, "session_id": null });
    match client.post(format!("{}/classify", intent_url))
        .json(&body)
        .timeout(std::time::Duration::from_secs(5))
        .send().await
    {
        Ok(resp) => {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                let model = data.get("model")
                    .and_then(|m| m.as_str())
                    .unwrap_or(simple_model)
                    .to_string();
                let layer = data.get("layer")
                    .and_then(|l| l.as_str())
                    .unwrap_or("L3")
                    .to_string();
                return (model, layer);
            }
            (simple_model.to_string(), "L3".to_string())
        }
        Err(_) => {
            // Python 服务不可用时用规则引擎 fallback
            let model = if is_complex(prompt) {
                complex_model.to_string()
            } else {
                simple_model.to_string()
            };
            (model, "L1".to_string())
        }
    }
}

fn infer_provider(model: &str) -> String {
    if model.starts_with("claude") { "anthropic".to_string() }
    else if model.starts_with("gpt") { "openai".to_string() }
    else { "ollama".to_string() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::{MockServer, Mock, ResponseTemplate};
    use wiremock::matchers::{method, path};
    use std::time::{Duration, Instant};

    /// 用例 1：Python 服务正常返回 L2（语义缓存命中）
    #[tokio::test]
    async fn test_call_intent_l2_hit() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/classify"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "complexity": "simple",
                    "model": "qwen2.5:7b",
                    "layer": "L2",
                    "confidence": 0.92,
                    "latency_ms": 3.5
                }))
            )
            .mount(&server)
            .await;

        let (model, layer) = call_intent(
            &server.uri(),
            "What is Rust?",
            "qwen2.5:7b",
            "claude-sonnet-4-6",
        ).await;

        assert_eq!(model, "qwen2.5:7b",  "L2 命中：model 应取自响应");
        assert_eq!(layer, "L2",          "L2 命中：layer 应为 L2");
    }

    /// 用例 2：Python 服务正常返回 L3（Ollama Few-Shot 分类）
    #[tokio::test]
    async fn test_call_intent_l3_classification() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/classify"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "complexity": "complex",
                    "model": "claude-sonnet-4-6",
                    "layer": "L3",
                    "confidence": 0.87,
                    "latency_ms": 1240.0
                }))
            )
            .mount(&server)
            .await;

        let (model, layer) = call_intent(
            &server.uri(),
            "Design a distributed caching system with consistency guarantees",
            "qwen2.5:7b",
            "claude-sonnet-4-6",
        ).await;

        assert_eq!(model, "claude-sonnet-4-6", "L3 分类：model 应取自响应");
        assert_eq!(layer, "L3",               "L3 分类：layer 应为 L3，非硬编码 L2");
    }

    /// 用例 3：Python 服务超时，fallback 到规则引擎（L1）
    #[tokio::test]
    async fn test_call_intent_timeout_fallback() {
        let server = MockServer::start().await;

        // mock 延迟 6s，超过 call_intent 内部 5s timeout
        Mock::given(method("POST"))
            .and(path("/classify"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_delay(Duration::from_secs(6))
                    .set_body_json(serde_json::json!({ "model": "qwen2.5:7b", "layer": "L2" }))
            )
            .mount(&server)
            .await;

        let start = Instant::now();
        let (model, layer) = call_intent(
            &server.uri(),
            "hello world",   // is_complex() → false → simple_model
            "qwen2.5:7b",
            "claude-sonnet-4-6",
        ).await;
        let elapsed = start.elapsed();

        assert_eq!(model, "qwen2.5:7b", "超时 fallback：简单 prompt 应选 simple_model");
        assert_eq!(layer, "L1",         "超时 fallback：layer 应为 L1（规则引擎）");
        assert!(elapsed < Duration::from_secs(6), "超时应在 5s 内触发，实际: {:?}", elapsed);
    }
}
