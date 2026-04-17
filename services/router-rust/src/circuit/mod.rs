use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

#[derive(Debug, Clone, PartialEq)]
pub enum CircuitState {
    Closed,
    Open,
    HalfOpen,
}

impl CircuitState {
    pub fn as_str(&self) -> &'static str {
        match self {
            CircuitState::Closed => "Closed",
            CircuitState::Open => "Open",
            CircuitState::HalfOpen => "HalfOpen",
        }
    }
}

#[derive(Serialize, Clone)]
pub struct CircuitStatus {
    pub state: String,
    pub failure_count: u32,
    pub allowed: bool,
    pub last_failure_at: Option<String>,
}

struct ProviderCircuit {
    state: CircuitState,
    failure_count: u32,
    success_count: u32,
    last_failure_at: Option<Instant>,
    opened_at: Option<Instant>,
}

impl ProviderCircuit {
    fn new() -> Self {
        Self {
            state: CircuitState::Closed,
            failure_count: 0,
            success_count: 0,
            last_failure_at: None,
            opened_at: None,
        }
    }
}

pub struct CircuitBreaker {
    circuits: Mutex<HashMap<String, ProviderCircuit>>,
    failure_threshold: u32,
    reset_timeout_secs: u64,
    half_open_successes: u32,
}

impl CircuitBreaker {
    pub fn new() -> Self {
        let failure_threshold: u32 = std::env::var("CIRCUIT_FAILURE_THRESHOLD")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(5);
        let reset_timeout_secs: u64 = std::env::var("CIRCUIT_RESET_TIMEOUT_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(30);
        let half_open_successes: u32 = std::env::var("CIRCUIT_HALF_OPEN_SUCCESSES")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(2);

        Self {
            circuits: Mutex::new(HashMap::new()),
            failure_threshold,
            reset_timeout_secs,
            half_open_successes,
        }
    }

    #[cfg(test)]
    fn with_config(failure_threshold: u32, reset_timeout_secs: u64, half_open_successes: u32) -> Self {
        Self {
            circuits: Mutex::new(HashMap::new()),
            failure_threshold,
            reset_timeout_secs,
            half_open_successes,
        }
    }

    /// Check if a request to the given provider is allowed.
    /// In Open state, checks if reset_timeout has elapsed → transitions to HalfOpen.
    pub fn is_allowed(&self, provider: &str) -> bool {
        let mut circuits = self.circuits.lock().unwrap();
        let circuit = circuits.entry(provider.to_string()).or_insert_with(ProviderCircuit::new);

        match circuit.state {
            CircuitState::Closed => true,
            CircuitState::HalfOpen => true,
            CircuitState::Open => {
                if let Some(opened_at) = circuit.opened_at {
                    if opened_at.elapsed().as_secs() >= self.reset_timeout_secs {
                        // Timeout elapsed → transition to HalfOpen (probe request)
                        circuit.state = CircuitState::HalfOpen;
                        circuit.success_count = 0;
                        true
                    } else {
                        false
                    }
                } else {
                    false
                }
            }
        }
    }

    /// Record a successful request. In HalfOpen, may transition to Closed.
    pub fn record_success(&self, provider: &str) {
        let mut circuits = self.circuits.lock().unwrap();
        let circuit = circuits.entry(provider.to_string()).or_insert_with(ProviderCircuit::new);

        match circuit.state {
            CircuitState::HalfOpen => {
                circuit.success_count += 1;
                if circuit.success_count >= self.half_open_successes {
                    circuit.state = CircuitState::Closed;
                    circuit.failure_count = 0;
                    circuit.success_count = 0;
                    circuit.opened_at = None;
                    circuit.last_failure_at = None;
                }
            }
            CircuitState::Closed => {
                // Reset failure count on success in closed state
                circuit.failure_count = 0;
            }
            CircuitState::Open => {
                // Ignore success in open state (shouldn't happen normally)
            }
        }
    }

    /// Record a failed request. In Closed, may transition to Open.
    /// In HalfOpen, immediately transitions back to Open.
    pub fn record_failure(&self, provider: &str) {
        let mut circuits = self.circuits.lock().unwrap();
        let circuit = circuits.entry(provider.to_string()).or_insert_with(ProviderCircuit::new);

        circuit.last_failure_at = Some(Instant::now());

        match circuit.state {
            CircuitState::Closed => {
                circuit.failure_count += 1;
                if circuit.failure_count >= self.failure_threshold {
                    circuit.state = CircuitState::Open;
                    circuit.opened_at = Some(Instant::now());
                }
            }
            CircuitState::HalfOpen => {
                // Any failure in HalfOpen → immediately back to Open
                circuit.state = CircuitState::Open;
                circuit.opened_at = Some(Instant::now());
                circuit.success_count = 0;
            }
            CircuitState::Open => {
                // Already open, just update failure info
                circuit.failure_count += 1;
            }
        }
    }

    /// Manually reset a specific provider's circuit to Closed.
    pub fn reset(&self, provider: &str) {
        let mut circuits = self.circuits.lock().unwrap();
        if let Some(circuit) = circuits.get_mut(provider) {
            circuit.state = CircuitState::Closed;
            circuit.failure_count = 0;
            circuit.success_count = 0;
            circuit.opened_at = None;
            circuit.last_failure_at = None;
        }
    }

    /// Get status of a specific provider's circuit.
    pub fn status(&self, provider: &str) -> CircuitStatus {
        let circuits = self.circuits.lock().unwrap();
        match circuits.get(provider) {
            Some(circuit) => {
                let allowed = match circuit.state {
                    CircuitState::Closed | CircuitState::HalfOpen => true,
                    CircuitState::Open => {
                        if let Some(opened_at) = circuit.opened_at {
                            opened_at.elapsed().as_secs() >= self.reset_timeout_secs
                        } else {
                            false
                        }
                    }
                };
                CircuitStatus {
                    state: circuit.state.as_str().to_string(),
                    failure_count: circuit.failure_count,
                    allowed,
                    last_failure_at: circuit.last_failure_at.map(|t| format!("{:.0}s ago", t.elapsed().as_secs_f64())),
                }
            }
            None => CircuitStatus {
                state: "Closed".to_string(),
                failure_count: 0,
                allowed: true,
                last_failure_at: None,
            },
        }
    }

    /// Get status of all known provider circuits.
    pub fn status_all(&self) -> HashMap<String, CircuitStatus> {
        let circuits = self.circuits.lock().unwrap();
        circuits.iter().map(|(name, circuit)| {
            let allowed = match circuit.state {
                CircuitState::Closed | CircuitState::HalfOpen => true,
                CircuitState::Open => {
                    if let Some(opened_at) = circuit.opened_at {
                        opened_at.elapsed().as_secs() >= self.reset_timeout_secs
                    } else {
                        false
                    }
                }
            };
            (name.clone(), CircuitStatus {
                state: circuit.state.as_str().to_string(),
                failure_count: circuit.failure_count,
                allowed,
                last_failure_at: circuit.last_failure_at.map(|t| format!("{:.0}s ago", t.elapsed().as_secs_f64())),
            })
        }).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_initial_state_is_closed() {
        let cb = CircuitBreaker::with_config(5, 30, 2);
        let status = cb.status("anthropic");
        assert_eq!(status.state, "Closed");
        assert_eq!(status.failure_count, 0);
        assert!(status.allowed);
    }

    #[test]
    fn test_open_after_threshold() {
        let cb = CircuitBreaker::with_config(3, 30, 2);
        for _ in 0..3 {
            cb.record_failure("anthropic");
        }
        let status = cb.status("anthropic");
        assert_eq!(status.state, "Open");
        assert_eq!(status.failure_count, 3);
        assert!(!status.allowed); // reset_timeout hasn't elapsed
    }

    #[test]
    fn test_blocked_while_open() {
        let cb = CircuitBreaker::with_config(2, 9999, 2); // very long timeout
        cb.record_failure("openai");
        cb.record_failure("openai");
        assert!(!cb.is_allowed("openai"));
    }

    #[test]
    fn test_half_open_after_timeout() {
        let cb = CircuitBreaker::with_config(2, 0, 2); // 0s timeout → immediate HalfOpen
        cb.record_failure("anthropic");
        cb.record_failure("anthropic");
        // After 0s timeout, should transition to HalfOpen
        assert!(cb.is_allowed("anthropic"));
        let status = cb.status("anthropic");
        assert_eq!(status.state, "HalfOpen");
    }

    #[test]
    fn test_close_after_half_open_successes() {
        let cb = CircuitBreaker::with_config(2, 0, 2); // 0s timeout, 2 successes needed
        cb.record_failure("anthropic");
        cb.record_failure("anthropic");
        // Transition to HalfOpen
        assert!(cb.is_allowed("anthropic"));
        // Two successes → back to Closed
        cb.record_success("anthropic");
        cb.record_success("anthropic");
        let status = cb.status("anthropic");
        assert_eq!(status.state, "Closed");
        assert_eq!(status.failure_count, 0);
    }

    #[test]
    fn test_half_open_failure_reopens() {
        let cb = CircuitBreaker::with_config(2, 0, 2);
        cb.record_failure("anthropic");
        cb.record_failure("anthropic");
        // Transition to HalfOpen
        cb.is_allowed("anthropic");
        // One failure → back to Open
        cb.record_failure("anthropic");
        let status = cb.status("anthropic");
        assert_eq!(status.state, "Open");
    }

    #[test]
    fn test_manual_reset() {
        let cb = CircuitBreaker::with_config(2, 9999, 2);
        cb.record_failure("anthropic");
        cb.record_failure("anthropic");
        assert_eq!(cb.status("anthropic").state, "Open");
        cb.reset("anthropic");
        let status = cb.status("anthropic");
        assert_eq!(status.state, "Closed");
        assert_eq!(status.failure_count, 0);
        assert!(status.allowed);
    }

    #[test]
    fn test_multi_provider_isolation() {
        let cb = CircuitBreaker::with_config(2, 9999, 2);
        cb.record_failure("anthropic");
        cb.record_failure("anthropic");
        // anthropic is Open
        assert_eq!(cb.status("anthropic").state, "Open");
        // openai is still Closed (isolated)
        assert_eq!(cb.status("openai").state, "Closed");
        assert!(cb.is_allowed("openai"));
    }
}
