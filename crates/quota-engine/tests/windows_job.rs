#![cfg(windows)]

use quota_engine::windows_job::{ExecutablePin, JobError, JobProcess, StartOptions};
use std::{
    collections::BTreeMap,
    env,
    ffi::OsString,
    fs, io,
    os::windows::process::CommandExt,
    process::Command,
    thread,
    time::{Duration, Instant},
};
use windows::Win32::{
    Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT},
    System::Threading::{OpenProcess, WaitForSingleObject, CREATE_NO_WINDOW, PROCESS_SYNCHRONIZE},
};

const CHILD_READY: &str = "job-fixture-child.pid";

struct ChildHandle(HANDLE);

impl Drop for ChildHandle {
    fn drop(&mut self) {
        // SAFETY: OpenProcess returned this owned handle and we close it once.
        let _ = unsafe { CloseHandle(self.0) };
    }
}

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
    let readiness = scratch.path().join(CHILD_READY);
    let child_pid = loop {
        match fs::read_to_string(&readiness) {
            Ok(pid) if pid.ends_with('\n') => break pid.trim().parse::<u32>()?,
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        assert!(Instant::now() < deadline, "descendant did not become ready");
        assert_eq!(
            job.wait(Duration::from_millis(25))?,
            None,
            "fixture exited early"
        );
    };

    // SAFETY: The sleeping fixture advertised its PID. This opens a wait-only handle.
    let descendant = ChildHandle(unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, child_pid)? });
    // SAFETY: The owned handle stays valid through both waits.
    assert_eq!(
        unsafe { WaitForSingleObject(descendant.0, 0) },
        WAIT_TIMEOUT
    );
    assert!(job.active()? >= 2);
    job.terminate()?;
    assert_eq!(job.wait(Duration::from_secs(5))?, Some(1));
    // SAFETY: The wait-only handle remains valid after its process exits.
    assert_eq!(
        unsafe { WaitForSingleObject(descendant.0, 5000) },
        WAIT_OBJECT_0
    );
    let deadline = Instant::now() + Duration::from_secs(5);
    while job.active()? != 0 && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(job.active()?, 0);
    Ok(())
}

#[test]
fn visible_login_console_reaps_descendants_when_canceled() -> Result<(), Box<dyn std::error::Error>>
{
    use std::cell::Cell;
    let scratch = tempfile::tempdir()?;
    let pin = ExecutablePin::new(&env::current_exe()?)?;
    let arguments = ["--exact", "job_fixture_parent"].map(OsString::from);
    let mut environment = BTreeMap::from([("QUOTA_JOB_FIXTURE".into(), "parent".into())]);
    if let Some(system) = env::var_os("SystemRoot") {
        environment.insert("SystemRoot".into(), system);
    }
    let readiness = scratch.path().join(CHILD_READY);
    let descendant = Cell::new(None);
    let result = JobProcess::run_console(
        &pin,
        StartOptions {
            cwd: scratch.path(),
            arguments: &arguments,
            environment: &environment,
        },
        Duration::from_secs(10),
        || {
            if let Some(pid) = fs::read_to_string(&readiness)
                .ok()
                .and_then(|text| text.trim().parse().ok())
            {
                // SAFETY: The fixture published the PID of its own sleeping child.
                // Open only a wait handle and keep it until the test observes exit.
                if let Ok(handle) = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid) } {
                    descendant.set(Some(ChildHandle(handle)));
                    return true;
                }
            }
            false
        },
    );
    assert!(matches!(result, Err(JobError::Canceled)));
    let child = descendant
        .into_inner()
        .ok_or(io::Error::other("child never became ready"))?;
    // SAFETY: The guard owns a valid wait handle until after this call.
    // Windows can report zero active Job processes just before the process object signals.
    assert_eq!(unsafe { WaitForSingleObject(child.0, 3000) }, WAIT_OBJECT_0);
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
        .creation_flags(CREATE_NO_WINDOW.0)
        .spawn()?;
    child.wait()?;
    Ok(())
}

#[test]
fn job_fixture_child() -> io::Result<()> {
    if env::var("QUOTA_JOB_FIXTURE").as_deref() == Ok("child") {
        fs::write(CHILD_READY, format!("{}\n", std::process::id()))?;
        thread::sleep(Duration::from_secs(30));
    }
    Ok(())
}

#[test]
fn captured_runner_cancels_the_entire_tree_and_rejects_stale_sha256(
) -> Result<(), Box<dyn std::error::Error>> {
    let scratch = tempfile::tempdir()?;
    let executable = env::current_exe()?;
    let pin = ExecutablePin::new(&executable)?;
    let arguments = ["--exact", "job_fixture_parent"].map(OsString::from);
    let environment = fixture_environment("parent");
    let options = || StartOptions {
        cwd: scratch.path(),
        arguments: &arguments,
        environment: &environment,
    };
    let wrong = ExecutablePin::from_sha256(&executable, &"00".repeat(32))?;
    assert!(matches!(
        JobProcess::run(&wrong, options(), Duration::from_secs(2), 1024, || false),
        Err(JobError::BinaryChanged)
    ));
    assert!(!scratch.path().join(CHILD_READY).exists());
    let descendant = std::cell::RefCell::new(None);
    let result = JobProcess::run(&pin, options(), Duration::from_secs(10), 524288, || {
        let Some(pid) = fs::read_to_string(scratch.path().join(CHILD_READY))
            .ok()
            .filter(|value| value.ends_with('\n'))
            .and_then(|pid| pid.trim().parse().ok())
        else {
            return false;
        };
        // SAFETY: The PID is written by this test's child. Only wait access is requested.
        let Ok(handle) = (unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid) }) else {
            return false;
        };
        *descendant.borrow_mut() = Some(ChildHandle(handle));
        true
    });
    assert!(matches!(result, Err(JobError::Canceled)));
    let handle = descendant
        .into_inner()
        .ok_or("fixture child was never ready")?;
    // SAFETY: The owned child handle remains valid after its process is reaped.
    assert_eq!(
        unsafe { WaitForSingleObject(handle.0, 5000) },
        WAIT_OBJECT_0
    );
    Ok(())
}

fn fixture_environment(role: &str) -> BTreeMap<OsString, OsString> {
    let mut vars = BTreeMap::from([(OsString::from("QUOTA_JOB_FIXTURE"), OsString::from(role))]);
    if let Some(root) = env::var_os("SystemRoot") {
        vars.insert(OsString::from("SystemRoot"), root);
    }
    vars
}

#[test]
fn closing_fixture_host_reaps_job_without_userland_cleanup(
) -> Result<(), Box<dyn std::error::Error>> {
    let scratch = tempfile::tempdir()?;
    let mut host = Command::new(env::current_exe()?)
        .args(["--exact", "job_fixture_host"])
        .envs(fixture_environment("host"))
        .current_dir(scratch.path())
        .creation_flags(CREATE_NO_WINDOW.0)
        .spawn()?;
    let result = (|| -> Result<ChildHandle, Box<dyn std::error::Error>> {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if let Ok(text) = fs::read_to_string(scratch.path().join(CHILD_READY)) {
                if text.ends_with('\n') {
                    let pid = text.trim().parse()?;
                    // SAFETY: This opens the test fixture descendant in wait-only mode.
                    return Ok(ChildHandle(unsafe {
                        OpenProcess(PROCESS_SYNCHRONIZE, false, pid)?
                    }));
                }
            }
            if Instant::now() >= deadline || host.try_wait()?.is_some() {
                return Err("job fixture host did not start its descendant".into());
            }
            thread::sleep(Duration::from_millis(10));
        }
    })();
    host.kill()?;
    host.wait()?;
    let descendant = result?;
    // SAFETY: The test owns the handle and only waits for the killed descendant.
    assert_eq!(
        unsafe { WaitForSingleObject(descendant.0, 5000) },
        WAIT_OBJECT_0
    );
    Ok(())
}

#[test]
fn job_fixture_host() -> Result<(), Box<dyn std::error::Error>> {
    if env::var("QUOTA_JOB_FIXTURE").as_deref() != Ok("host") {
        return Ok(());
    }
    let pin = ExecutablePin::new(&env::current_exe()?)?;
    let directory = env::current_dir()?;
    let args = ["--exact", "job_fixture_parent"].map(OsString::from);
    let _ = JobProcess::run(
        &pin,
        StartOptions {
            cwd: &directory,
            arguments: &args,
            environment: &fixture_environment("parent"),
        },
        Duration::from_secs(20),
        524288,
        || false,
    );
    Ok(())
}

#[test]
fn job_fixture_line_server() -> io::Result<()> {
    use std::io::{BufRead, Write};
    if env::var("QUOTA_JOB_FIXTURE").as_deref() != Ok("line-server") {
        return Ok(());
    }
    let mut line = String::new();
    io::stdin().lock().read_line(&mut line)?;
    eprintln!("synthetic server diagnostics stay separate");
    let mut stdout = io::stdout().lock();
    writeln!(stdout, "reply:{}", line.trim_end())?;
    stdout.flush()?;
    thread::sleep(Duration::from_secs(30));
    Ok(())
}

#[test]
fn pinned_job_supports_bounded_bidirectional_stdio() -> Result<(), Box<dyn std::error::Error>> {
    let root = tempfile::tempdir()?;
    let pin = ExecutablePin::new(&env::current_exe()?)?;
    let arguments = ["--exact", "job_fixture_line_server", "--nocapture"].map(OsString::from);
    let mut environment = BTreeMap::from([(
        OsString::from("QUOTA_JOB_FIXTURE"),
        OsString::from("line-server"),
    )]);
    if let Some(system) = env::var_os("SystemRoot") {
        environment.insert(OsString::from("SystemRoot"), system);
    }
    let mut job = JobProcess::start_lines(
        &pin,
        StartOptions {
            cwd: root.path(),
            arguments: &arguments,
            environment: &environment,
        },
    )?;
    job.send(b"synthetic request\n")?;
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let line = job.next_line(deadline, || false)?;
        assert!(!line.starts_with(b"synthetic server diagnostics"));
        if line.starts_with(b"reply:") {
            assert_eq!(
                std::str::from_utf8(&line)?.trim_end(),
                "reply:synthetic request"
            );
            break;
        }
    }
    assert!(matches!(
        job.next_line(deadline, || true),
        Err(JobError::Canceled)
    ));
    Ok(())
}
