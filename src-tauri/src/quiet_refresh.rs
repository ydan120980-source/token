use std::{collections::HashMap, sync::Mutex};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Attempt {
    Manual,
    Scheduled,
    Retry,
}

impl Attempt {
    pub fn automatic(self) -> bool {
        self != Self::Manual
    }
}

#[derive(Default)]
struct ReadState {
    failed_ticks: u8,
    program_at: Option<i64>,
}

#[derive(Default)]
pub struct QuietRefresh(Mutex<HashMap<String, ReadState>>);

impl QuietRefresh {
    pub fn can_hide(&self, id: &str, attempt: Attempt, prior_quota: bool, code: &str) -> bool {
        if !attempt.automatic()
            || !prior_quota
            || !matches!(
                code,
                "PROVIDER_TIMEOUT"
                    | "PROVIDER_REQUEST_FAILED"
                    | "CODEX_REQUEST_TIMEOUT"
                    | "CODEX_REQUEST_FAILED"
            )
        {
            return false;
        }
        self.0.lock().is_ok_and(|accounts| {
            let ticks = accounts.get(id).map_or(0, |account| account.failed_ticks);
            ticks + u8::from(attempt == Attempt::Retry) < 3
        })
    }

    pub fn hidden(&self, id: &str, attempt: Attempt, program_at: Option<i64>) {
        if let Ok(mut accounts) = self.0.lock() {
            let state = accounts.entry(id.to_owned()).or_default();
            if attempt == Attempt::Retry {
                state.failed_ticks += 1;
            }
            if program_at.is_some() {
                state.program_at = program_at;
            }
        }
    }

    pub fn program_due(&self, id: &str, now: i64) -> bool {
        self.0.lock().is_ok_and(|accounts| {
            accounts
                .get(id)
                .and_then(|account| account.program_at)
                .is_none_or(|at| now.saturating_sub(at) >= 300_000)
        })
    }

    pub fn forget(&self, id: &str) {
        if let Ok(mut accounts) = self.0.lock() {
            accounts.remove(id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attempts_follow_the_three_tick_electron_boundary() {
        let quiet = QuietRefresh::default();
        for code in ["PROVIDER_TIMEOUT", "CODEX_REQUEST_FAILED"] {
            for _ in 0..2 {
                assert!(quiet.can_hide("a", Attempt::Scheduled, true, code));
                quiet.hidden("a", Attempt::Scheduled, None);
                assert!(quiet.can_hide("a", Attempt::Retry, true, code));
                quiet.hidden("a", Attempt::Retry, None);
            }
            assert!(quiet.can_hide("a", Attempt::Scheduled, true, code));
            assert!(!quiet.can_hide("a", Attempt::Retry, true, code));
            assert!(!quiet.can_hide("a", Attempt::Manual, true, code));
            assert!(!quiet.can_hide("b", Attempt::Scheduled, false, code));
            assert!(!quiet.can_hide("b", Attempt::Scheduled, true, "PROVIDER_RATE_LIMITED"));
            quiet.forget("a");
            assert!(quiet.can_hide("a", Attempt::Retry, true, code));
        }
    }

    #[test]
    fn quiet_program_attempt_keeps_the_five_minute_cadence() {
        let quiet = QuietRefresh::default();
        quiet.hidden("a", Attempt::Scheduled, Some(7));
        assert!(!quiet.program_due("a", 300_006));
        assert!(quiet.program_due("a", 300_007));
        assert!(quiet.program_due("b", 7));
    }
}
