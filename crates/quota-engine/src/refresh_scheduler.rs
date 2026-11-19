use serde::Serialize;
use std::{
    collections::VecDeque,
    fmt,
    sync::{Arc, Mutex},
};
use tokio::sync::Notify;

#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub limit: usize,
    pub per_provider: usize,
    pub cli_limit: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            limit: 16,
            per_provider: 4,
            cli_limit: 4,
        }
    }
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerState {
    pub limit: usize,
    pub per_provider: usize,
    pub cli_limit: usize,
    pub active: usize,
    pub queued: usize,
}

#[derive(Debug)]
pub struct Scope {
    pub provider: String,
    pub cli: bool,
    pub key: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Rejected {
    InvalidLimits,
    Unavailable,
}

impl fmt::Display for Rejected {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidLimits => "REFRESH_LIMIT_INVALID",
            Self::Unavailable => "REFRESH_SCHEDULER_UNAVAILABLE",
        })
    }
}

impl std::error::Error for Rejected {}

struct Entry {
    id: u64,
    scope: Scope,
}

#[derive(Default)]
struct Queue {
    next: u64,
    waiting: VecDeque<Entry>,
    active: Vec<Entry>,
}

impl Queue {
    fn eligible(&self, scope: &Scope, limits: Limits) -> bool {
        self.active
            .iter()
            .filter(|item| item.scope.provider == scope.provider)
            .count()
            < limits.per_provider
            && (!scope.cli
                || self.active.iter().filter(|item| item.scope.cli).count() < limits.cli_limit)
            && scope
                .key
                .as_deref()
                .filter(|key| !key.is_empty())
                .is_none_or(|key| {
                    !self
                        .active
                        .iter()
                        .any(|item| item.scope.key.as_deref() == Some(key))
                })
    }
}

struct Inner {
    limits: Limits,
    queue: Mutex<Queue>,
    changed: Notify,
}

#[derive(Clone)]
pub struct RefreshScheduler(Arc<Inner>);

pub struct RefreshPermit {
    inner: Arc<Inner>,
    id: u64,
}

impl RefreshScheduler {
    pub fn new(limits: Limits) -> Result<Self, Rejected> {
        if [limits.limit, limits.per_provider, limits.cli_limit]
            .into_iter()
            .any(|n| !(1..=16).contains(&n))
        {
            return Err(Rejected::InvalidLimits);
        }
        Ok(Self(Arc::new(Inner {
            limits,
            queue: Mutex::new(Queue::default()),
            changed: Notify::new(),
        })))
    }

    pub fn state(&self) -> Result<SchedulerState, Rejected> {
        let queue = self.0.queue.lock().map_err(|_| Rejected::Unavailable)?;
        let Limits {
            limit,
            per_provider,
            cli_limit,
        } = self.0.limits;
        Ok(SchedulerState {
            limit,
            per_provider,
            cli_limit,
            active: queue.active.len(),
            queued: queue.waiting.len(),
        })
    }

    /// Polling registers the job. Dropping a queued acquisition removes it,
    /// and dropping the admitted permit releases every one of its limits.
    pub async fn acquire(&self, scope: Scope) -> Result<RefreshPermit, Rejected> {
        let id = {
            let mut queue = self.0.queue.lock().map_err(|_| Rejected::Unavailable)?;
            let id = queue.next;
            queue.next = id.checked_add(1).ok_or(Rejected::Unavailable)?;
            queue.waiting.push_back(Entry { id, scope });
            id
        };
        let ticket = RefreshPermit {
            inner: Arc::clone(&self.0),
            id,
        };
        loop {
            let wake = self.0.changed.notified();
            tokio::pin!(wake);
            wake.as_mut().enable();
            if self.try_admit(id)? {
                self.0.changed.notify_waiters();
                return Ok(ticket);
            }
            wake.await;
        }
    }

    fn try_admit(&self, id: u64) -> Result<bool, Rejected> {
        let mut queue = self.0.queue.lock().map_err(|_| Rejected::Unavailable)?;
        if queue.active.len() >= self.0.limits.limit {
            return Ok(false);
        }
        let eligible = queue
            .waiting
            .iter()
            .position(|entry| queue.eligible(&entry.scope, self.0.limits));
        if let Some(index) = eligible.filter(|&index| queue.waiting[index].id == id) {
            let entry = queue.waiting.remove(index).ok_or(Rejected::Unavailable)?;
            queue.active.push(entry);
            return Ok(true);
        }
        Ok(false)
    }
}

impl Drop for RefreshPermit {
    fn drop(&mut self) {
        if let Ok(mut queue) = self.inner.queue.lock() {
            queue.active.retain(|entry| entry.id != self.id);
            queue.waiting.retain(|entry| entry.id != self.id);
        }
        self.inner.changed.notify_waiters();
    }
}
