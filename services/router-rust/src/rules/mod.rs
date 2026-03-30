use std::sync::atomic::{AtomicU64, Ordering};

/// Simple rule-based complexity classifier.
#[allow(dead_code)]
pub fn is_complex(prompt: &str) -> bool {
    let word_count = prompt.split_whitespace().count();
    let has_code = prompt.contains("```") || prompt.contains("fn ") || prompt.contains("def ");
    let has_complex_keywords = ["architect", "design", "implement", "refactor", "optimize", "debug"]
        .iter()
        .any(|kw| prompt.to_lowercase().contains(kw));
    word_count > 50 || has_code || has_complex_keywords
}

/// Thread-safe routing statistics.
pub struct RouteStats {
    total: AtomicU64,
    hits: AtomicU64,
}

impl RouteStats {
    pub fn new() -> Self {
        Self {
            total: AtomicU64::new(0),
            hits: AtomicU64::new(0),
        }
    }

    pub fn incr_total(&self) { self.total.fetch_add(1, Ordering::Relaxed); }
    pub fn incr_hit(&self) { self.hits.fetch_add(1, Ordering::Relaxed); }
    pub fn total(&self) -> u64 { self.total.load(Ordering::Relaxed) }
    pub fn hits(&self) -> u64 { self.hits.load(Ordering::Relaxed) }
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
        assert_eq!(stats.total(), 2);
        assert_eq!(stats.hits(), 1);
    }
}
