use quota_engine::refresh_scheduler::{Limits, RefreshScheduler, Scope};
use std::{
    future::{poll_fn, Future},
    task::Poll,
    time::Duration,
};

fn scope(provider: &str, cli: bool, key: Option<&str>) -> Scope {
    Scope {
        provider: provider.to_owned(),
        cli,
        key: key.map(str::to_owned),
    }
}

#[tokio::test]
async fn blocked_scopes_do_not_block_an_eligible_provider_and_canceled_jobs_leave_no_ticket(
) -> Result<(), Box<dyn std::error::Error>> {
    let pool = RefreshScheduler::new(Limits {
        limit: 3,
        per_provider: 1,
        cli_limit: 1,
    })?;
    let first = pool.acquire(scope("codex", true, Some("one"))).await?;
    let mut provider = Box::pin(pool.acquire(scope("codex", false, None)));
    let mut cli = Box::pin(pool.acquire(scope("claude", true, None)));
    let mut key = Box::pin(pool.acquire(scope("gemini", false, Some("one"))));
    for blocked in [&mut provider, &mut cli, &mut key] {
        poll_fn(|cx| {
            assert!(blocked.as_mut().poll(cx).is_pending());
            Poll::Ready(())
        })
        .await;
    }
    let unrelated = pool.acquire(scope("other", false, None)).await?;
    assert_eq!(pool.state()?.active, 2);
    assert_eq!(pool.state()?.queued, 3);
    drop(cli);
    assert_eq!(pool.state()?.queued, 2);
    drop(first);
    let same_provider = tokio::time::timeout(Duration::from_secs(2), provider).await??;
    let same_key = tokio::time::timeout(Duration::from_secs(2), key).await??;
    assert_eq!(pool.state()?.active, 3);
    drop((unrelated, same_provider, same_key));
    assert_eq!(pool.state()?.active, 0);
    assert_eq!(pool.state()?.queued, 0);
    Ok(())
}
