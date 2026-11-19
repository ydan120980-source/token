use std::{
    fmt,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tokio::sync::Semaphore;

const REQUEST_BUDGET: Duration = Duration::from_secs(90);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TranscriptUnreadable;

impl fmt::Display for TranscriptUnreadable {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("TRANSCRIPT_UNREADABLE")
    }
}

impl std::error::Error for TranscriptUnreadable {}

/// The blocking reader checks cancellation between rows, files or other bounded steps.
pub struct ReadBudget {
    closed: Arc<AtomicBool>,
    started: Instant,
    limit: Duration,
}

impl ReadBudget {
    pub fn check(&self) -> Result<(), TranscriptUnreadable> {
        if self.closed.load(Ordering::Acquire) || self.started.elapsed() >= self.limit {
            return Err(TranscriptUnreadable);
        }
        Ok(())
    }
}

/// One lane on the host's existing blocking executor. No owned worker, parser heap, or warm cache.
pub struct TranscriptTasks {
    gate: Arc<Semaphore>,
    closed: Arc<AtomicBool>,
    request_budget: Duration,
}

impl Default for TranscriptTasks {
    fn default() -> Self {
        Self::new(REQUEST_BUDGET)
    }
}

impl TranscriptTasks {
    pub fn new(request_budget: Duration) -> Self {
        Self {
            gate: Arc::new(Semaphore::new(1)),
            closed: Arc::new(AtomicBool::new(false)),
            request_budget,
        }
    }

    /// Run one request, serializing parser allocations across readers even after a timeout.
    pub async fn run<Output, Error>(
        &self,
        read: impl FnOnce(&ReadBudget) -> Result<Output, Error> + Send + 'static,
    ) -> Result<Output, Error>
    where
        Output: Send + 'static,
        Error: From<TranscriptUnreadable> + Send + 'static,
    {
        if self.closed.load(Ordering::Acquire) {
            return Err(TranscriptUnreadable.into());
        }
        let permit = self
            .gate
            .to_owned()
            .acquire_owned()
            .await
            .map_err(|_| TranscriptUnreadable)?;
        if self.closed.load(Ordering::Acquire) {
            return Err(TranscriptUnreadable.into());
        }
        let request = ReadBudget {
            closed: self.closed.to_owned(),
            started: Instant::now(),
            limit: self.request_budget,
        };
        let task = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            request.check()?;
            let result = read(&request);
            request.check()?;
            result
        });
        tokio::time::timeout(self.request_budget, task)
            .await
            .map_err(|_| TranscriptUnreadable)?
            .map_err(|_| TranscriptUnreadable)?
    }

    /// Reject new work and drain the active blocking read before reporting shutdown.
    pub async fn close(&self) {
        self.closed.store(true, Ordering::Release);
        let _drained = self.gate.acquire().await;
    }
}
