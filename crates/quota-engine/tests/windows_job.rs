#![cfg(windows)]

use quota_engine::windows_job::{ExecutablePin, JobError, JobProcess, StartOptions};
use std::{
    collections::BTreeMap,
    env,
    ffi::OsString,
    fs,
    process::Command,
    thread,
    time::{Duration, Instant},
};

#[test]
fn native_job_reaps_parent_and_descendant_on_termination() -> Result<(), Box<dyn std::error::Error>>
{
    let scratch = tempfile::tempdir()?;
    let executable = env::current_exe()?;
    let pin = ExecutablePin::new(&executable)?;
    let arguments = ["--exact", "job_fixture_parent"].map(OsString::from);
    let mut environment = BTreeMap::from([(
        OsString::from("QUOTA_JOB_FIXTURE"),
        OsString::from("parent"),
    )]);
    if let Some(system) = env::var_os("SystemRoot") {
        environment.insert(OsString::from("SystemRoot"), system);
    }
    let job = JobProcess::start(
        &pin,
        StartOptions {
            cwd: scratch.path(),
            arguments: &arguments,
            environment: &environment,
        },
    )?;
    let deadline = Instant::now() + Duration::from_secs(10);
    while job.active()? < 2 && Instant::now() < deadline {
        assert_eq!(
            job.wait(Duration::from_millis(25))?,
            None,
            "fixture exited early"
        );
    }
    assert_eq!(job.active()?, 2);
    job.terminate()?;
    assert_eq!(job.wait(Duration::from_secs(5))?, Some(1));
    while job.active()? != 0 && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(job.active()?, 0);
    Ok(())
}

#[test]
fn native_job_rejects_a_changed_image_before_launch() -> Result<(), Box<dyn std::error::Error>> {
    let scratch = tempfile::tempdir()?;
    let path = scratch.path().join("fixture.exe");
    fs::write(&path, b"before")?;
    let pin = ExecutablePin::new(&path)?;
    fs::write(&path, b"after")?;
    let result = JobProcess::start(
        &pin,
        StartOptions {
            cwd: scratch.path(),
            arguments: &[],
            environment: &BTreeMap::new(),
        },
    );
    assert!(matches!(result, Err(JobError::BinaryChanged)));
    Ok(())
}

#[test]
fn job_fixture_parent() -> Result<(), Box<dyn std::error::Error>> {
    if env::var("QUOTA_JOB_FIXTURE").as_deref() != Ok("parent") {
        return Ok(());
    }
    let mut child = Command::new(env::current_exe()?)
        .args(["--exact", "job_fixture_child"])
        .env("QUOTA_JOB_FIXTURE", "child")
        .spawn()?;
    child.wait()?;
    Ok(())
}

#[test]
fn job_fixture_child() {
    if env::var("QUOTA_JOB_FIXTURE").as_deref() == Ok("child") {
        thread::sleep(Duration::from_secs(30));
    }
}
