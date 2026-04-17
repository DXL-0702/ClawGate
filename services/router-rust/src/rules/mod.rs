use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};

/// Configurable rule parameters.
pub struct RuleConfig {
    pub complex_keywords: Vec<String>,
    pub simple_keywords: Vec<String>,
    pub code_markers: Vec<String>,
    pub word_count_threshold: usize,
}

impl Default for RuleConfig {
    fn default() -> Self {
        Self {
            complex_keywords: vec![
                "architect", "design", "implement", "refactor", "optimize", "debug",
                "analyze", "migrate", "integrate", "distributed",
            ].into_iter().map(String::from).collect(),
            simple_keywords: vec![
                "hello", "hi", "thanks", "what is", "who is", "how are",
            ].into_iter().map(String::from).collect(),
            code_markers: vec![
                "```".to_string(), "fn ".to_string(), "def ".to_string(),
                "class ".to_string(), "import ".to_string(), "function ".to_string(),
            ],
            word_count_threshold: 50,
        }
    }
}

/// Detailed analysis result from rule evaluation.
#[derive(Debug, Serialize)]
pub struct RuleAnalysis {
    pub is_complex: bool,
    pub matched_rules: Vec<String>,
    pub token_estimate: usize,
    pub has_code: bool,
    pub has_complex_keywords: bool,
    pub has_question_only: bool,
}

/// Run full rule analysis on a prompt.
pub fn analyse(prompt: &str, config: &RuleConfig) -> RuleAnalysis {
    let lower = prompt.to_lowercase();
    let word_count = prompt.split_whitespace().count();
    let token_estimate = prompt.len() / 4;

    let has_code = config.code_markers.iter().any(|m| prompt.contains(m.as_str()));
    let has_complex_keywords = config.complex_keywords.iter().any(|kw| lower.contains(kw.as_str()));
    let has_question_only = word_count <= 8
        && !has_code
        && !has_complex_keywords
        && (lower.ends_with('?') || config.simple_keywords.iter().any(|kw| lower.contains(kw.as_str())));

    let mut matched_rules = Vec::new();

    if word_count > config.word_count_threshold {
        matched_rules.push(format!("word_count>{}", config.word_count_threshold));
    }
    if has_code {
        matched_rules.push("contains_code".to_string());
    }
    if has_complex_keywords {
        matched_rules.push("complex_keyword".to_string());
    }
    if has_question_only {
        matched_rules.push("simple_question".to_string());
    }

    let is_complex = word_count > config.word_count_threshold || has_code || has_complex_keywords;

    RuleAnalysis {
        is_complex,
        matched_rules,
        token_estimate,
        has_code,
        has_complex_keywords,
        has_question_only,
    }
}

/// Simple rule-based complexity classifier (backward compatible).
pub fn is_complex(prompt: &str) -> bool {
    analyse(prompt, &RuleConfig::default()).is_complex
}

/// Thread-safe routing statistics.
pub struct RouteStats {
    total: AtomicU64,
    hits: AtomicU64,
    rule_decisions: AtomicU64,
    complex_routed: AtomicU64,
    simple_routed: AtomicU64,
}

impl RouteStats {
    pub fn new() -> Self {
        Self {
            total: AtomicU64::new(0),
            hits: AtomicU64::new(0),
            rule_decisions: AtomicU64::new(0),
            complex_routed: AtomicU64::new(0),
            simple_routed: AtomicU64::new(0),
        }
    }

    pub fn incr_total(&self) { self.total.fetch_add(1, Ordering::Relaxed); }
    pub fn incr_hit(&self) { self.hits.fetch_add(1, Ordering::Relaxed); }
    pub fn incr_rule_decision(&self) { self.rule_decisions.fetch_add(1, Ordering::Relaxed); }
    pub fn incr_complex(&self) { self.complex_routed.fetch_add(1, Ordering::Relaxed); }
    pub fn incr_simple(&self) { self.simple_routed.fetch_add(1, Ordering::Relaxed); }
    pub fn total(&self) -> u64 { self.total.load(Ordering::Relaxed) }
    pub fn hits(&self) -> u64 { self.hits.load(Ordering::Relaxed) }
    pub fn rule_decisions(&self) -> u64 { self.rule_decisions.load(Ordering::Relaxed) }
    pub fn complex_routed(&self) -> u64 { self.complex_routed.load(Ordering::Relaxed) }
    pub fn simple_routed(&self) -> u64 { self.simple_routed.load(Ordering::Relaxed) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_short_prompt_is_simple() {
        assert!(!is_complex("hello world"));
    }

    #[test]
    fn test_long_prompt_is_complex() {
        let long = "word ".repeat(60);
        assert!(is_complex(&long));
    }

    #[test]
    fn test_code_prompt_is_complex() {
        assert!(is_complex("please write ```rust fn main() {}```"));
    }

    #[test]
    fn test_keyword_prompt_is_complex() {
        assert!(is_complex("please refactor this code"));
    }

    #[test]
    fn test_stats_counter() {
        let stats = RouteStats::new();
        stats.incr_total();
        stats.incr_total();
        stats.incr_hit();
        stats.incr_rule_decision();
        stats.incr_complex();
        stats.incr_simple();
        assert_eq!(stats.total(), 2);
        assert_eq!(stats.hits(), 1);
        assert_eq!(stats.rule_decisions(), 1);
        assert_eq!(stats.complex_routed(), 1);
        assert_eq!(stats.simple_routed(), 1);
    }

    #[test]
    fn test_analyse_simple_question() {
        let config = RuleConfig::default();
        let result = analyse("what is Rust?", &config);
        assert!(!result.is_complex);
        assert!(result.has_question_only);
        assert!(result.matched_rules.contains(&"simple_question".to_string()));
    }

    #[test]
    fn test_analyse_complex_with_code() {
        let config = RuleConfig::default();
        let result = analyse("```python\ndef sort(arr): pass\n```", &config);
        assert!(result.is_complex);
        assert!(result.has_code);
        assert!(result.matched_rules.contains(&"contains_code".to_string()));
    }

    #[test]
    fn test_analyse_token_estimate() {
        let config = RuleConfig::default();
        let prompt = "hello world"; // 11 chars → ~2 tokens
        let result = analyse(prompt, &config);
        assert_eq!(result.token_estimate, 11 / 4);
    }
}
