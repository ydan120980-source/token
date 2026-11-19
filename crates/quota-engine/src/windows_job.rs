use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    ffi::{OsStr, OsString},
    fmt,
    fs::{self, File, OpenOptions},
    io::{self, Read},
    mem::size_of,
    os::windows::{
        ffi::OsStrExt,
        fs::{MetadataExt, OpenOptionsExt},
    },
    path::{Component, Path, PathBuf, Prefix},
    time::Duration,
};
use windows::{
    core::{PCWSTR, PWSTR},
    Win32::{
        Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT},
        System::{
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicAccountingInformation,
                JobObjectExtendedLimitInformation, QueryInformationJobObject,
                SetInformationJobObject, TerminateJobObject,
                JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            },
            Threading::{
                CreateProcessW, GetExitCodeProcess, ResumeThread, TerminateProcess,
                WaitForSingleObject, CREATE_NO_WINDOW, CREATE_SUSPENDED,
                CREATE_UNICODE_ENVIRONMENT, PROCESS_INFORMATION, STARTUPINFOW,
            },
        },
    },
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JobError {
    Invalid,
    BinaryUnavailable,
    BinaryChanged,
    HostUnavailable,
    CleanupUnconfirmed,
}

impl fmt::Display for JobError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Invalid => "JOB_REQUEST_INVALID",
            Self::BinaryUnavailable => "JOB_BINARY_UNAVAILABLE",
            Self::BinaryChanged => "JOB_BINARY_CHANGED",
            Self::HostUnavailable => "JOB_HOST_UNAVAILABLE",
            Self::CleanupUnconfirmed => "JOB_CLEANUP_UNCONFIRMED",
        })
    }
}
impl std::error::Error for JobError {}

struct OwnedHandle(HANDLE);
impl Drop for OwnedHandle {
    fn drop(&mut self) {
        // SAFETY: Each guard receives one successful Win32 call's owned handle.
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

pub struct ExecutablePin {
    executable: PathBuf,
    digest: [u8; 32],
}

impl ExecutablePin {
    pub fn new(path: &Path) -> Result<Self, JobError> {
        if !local_path(path)
            || path
                .extension()
                .is_none_or(|extension| !extension.eq_ignore_ascii_case("exe"))
        {
            return Err(JobError::BinaryUnavailable);
        }
        let (_, digest) = fingerprint(path).map_err(|_| JobError::BinaryUnavailable)?;
        Ok(Self {
            executable: path.to_owned(),
            digest,
        })
    }
}

fn local_path(path: &Path) -> bool {
    path.is_absolute()
        && matches!(path.components().next(), Some(Component::Prefix(prefix))
        if matches!(prefix.kind(), Prefix::Disk(_))) && !path.components().any(|component| {
        matches!(component, Component::ParentDir | Component::CurDir)
            || matches!(component, Component::Normal(name) if name.to_string_lossy().contains(':'))
    })
}

fn reject_links(path: &Path) -> io::Result<()> {
    for parent in path.ancestors() {
        if fs::symlink_metadata(parent)?.file_attributes() & 0x400 != 0 {
            return Err(io::ErrorKind::PermissionDenied.into());
        }
    }
    Ok(())
}

fn fingerprint(path: &Path) -> io::Result<(File, [u8; 32])> {
    reject_links(path)?;
    // Keep the verified image open without FILE_SHARE_WRITE/DELETE until the
    // suspended process is created. Reject a reparse point at the file itself.
    let mut file = OpenOptions::new()
        .read(true)
        .share_mode(1)
        .custom_flags(0x0020_0000)
        .open(path)?;
    let meta = file.metadata()?;
    if !meta.is_file()
        || meta.file_attributes() & 0x400 != 0
        || !(1..=512 * 1024 * 1024).contains(&meta.len())
    {
        return Err(io::ErrorKind::InvalidData.into());
    }
    let mut hash = Sha256::new();
    let mut bytes = [0; 64 * 1024];
    loop {
        let count = file.read(&mut bytes)?;
        if count == 0 {
            break;
        }
        hash.update(&bytes[..count]);
    }
    Ok((file, hash.finalize().into()))
}

pub struct StartOptions<'a> {
    pub cwd: &'a Path,
    pub arguments: &'a [OsString],
    pub environment: &'a BTreeMap<OsString, OsString>,
}

pub struct JobProcess {
    job: OwnedHandle,
    process: OwnedHandle,
}

impl JobProcess {
    pub fn start(pin: &ExecutablePin, options: StartOptions<'_>) -> Result<Self, JobError> {
        if !local_path(options.cwd)
            || !options.cwd.is_dir()
            || reject_links(options.cwd).is_err()
            || options.arguments.len() > 64
            || options.environment.len() > 64
        {
            return Err(JobError::Invalid);
        }
        let executable = wide(pin.executable.as_os_str())?;
        let cwd = wide(options.cwd.as_os_str())?;
        let mut command = Vec::new();
        quote(pin.executable.as_os_str(), &mut command)?;
        for argument in options.arguments {
            command.push(b' ' as u16);
            quote(argument, &mut command)?;
        }
        if command.len() > 32_760 {
            return Err(JobError::Invalid);
        }
        command.push(0);
        let environment = environment_block(options.environment)?;
        let (image_lease, digest) =
            fingerprint(&pin.executable).map_err(|_| JobError::BinaryChanged)?;
        if digest != pin.digest {
            return Err(JobError::BinaryChanged);
        }
        // SAFETY: An unnamed job with default security attributes returns a
        // fresh, non-inheritable kernel handle, immediately placed in a guard.
        let job = OwnedHandle(
            unsafe { CreateJobObjectW(None, PCWSTR::null()) }
                .map_err(|_| JobError::HostUnavailable)?,
        );
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // SAFETY: Pointer and length refer to the initialized job-limit struct.
        unsafe {
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        }
        .map_err(|_| JobError::HostUnavailable)?;
        let start = STARTUPINFOW {
            cb: size_of::<STARTUPINFOW>() as u32,
            ..Default::default()
        };
        let mut output = PROCESS_INFORMATION::default();
        // SAFETY: Native arguments and explicit UTF-16 environment remain live
        // for the call. No handles are inherited. The initial thread is suspended.
        unsafe {
            CreateProcessW(
                PCWSTR(executable.as_ptr()),
                Some(PWSTR(command.as_mut_ptr())),
                None,
                None,
                false,
                CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT,
                Some(environment.as_ptr().cast()),
                PCWSTR(cwd.as_ptr()),
                &start,
                &mut output,
            )
        }
        .map_err(|_| JobError::HostUnavailable)?;
        let process = OwnedHandle(output.hProcess);
        let thread = OwnedHandle(output.hThread);
        // SAFETY: Both handles are valid and owned, and the process has not run.
        let assigned = unsafe { AssignProcessToJobObject(job.0, process.0) };
        if assigned.is_err() {
            // SAFETY: An unassigned, still suspended process must be explicitly
            // terminated here because closing the job alone cannot contain it.
            unsafe {
                TerminateProcess(process.0, 1).map_err(|_| JobError::CleanupUnconfirmed)?;
                if WaitForSingleObject(process.0, 3_000) != WAIT_OBJECT_0 {
                    return Err(JobError::CleanupUnconfirmed);
                }
            }
            return Err(JobError::HostUnavailable);
        }
        drop(image_lease);
        // SAFETY: The primary thread belongs to the just-assigned process.
        if unsafe { ResumeThread(thread.0) } == u32::MAX {
            return Err(JobError::HostUnavailable);
        }
        Ok(Self { job, process })
    }

    pub fn active(&self) -> Result<u32, JobError> {
        let mut stats = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
        // SAFETY: The job handle is still owned and stats is valid writable memory.
        unsafe {
            QueryInformationJobObject(
                Some(self.job.0),
                JobObjectBasicAccountingInformation,
                (&mut stats as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                None,
            )
        }
        .map_err(|_| JobError::CleanupUnconfirmed)?;
        Ok(stats.ActiveProcesses)
    }

    pub fn wait(&self, timeout: Duration) -> Result<Option<u32>, JobError> {
        let ms = timeout.as_millis().min(u128::from(u32::MAX - 1)) as u32;
        // SAFETY: Both APIs borrow the owned process handle while it is live.
        unsafe {
            let result = WaitForSingleObject(self.process.0, ms);
            if result == WAIT_TIMEOUT {
                return Ok(None);
            }
            if result != WAIT_OBJECT_0 {
                return Err(JobError::CleanupUnconfirmed);
            }
            let mut code = 0;
            GetExitCodeProcess(self.process.0, &mut code)
                .map_err(|_| JobError::CleanupUnconfirmed)?;
            Ok(Some(code))
        }
    }

    pub fn terminate(&self) -> Result<(), JobError> {
        // SAFETY: Termination is scoped to this newly created, owned job.
        unsafe { TerminateJobObject(self.job.0, 1) }.map_err(|_| JobError::CleanupUnconfirmed)
    }
}

fn wide(value: &OsStr) -> Result<Vec<u16>, JobError> {
    let mut text: Vec<_> = value.encode_wide().collect();
    if text.contains(&0) {
        return Err(JobError::Invalid);
    }
    text.push(0);
    Ok(text)
}

fn quote(value: &OsStr, out: &mut Vec<u16>) -> Result<(), JobError> {
    let slash = u16::from(b'\\');
    let quote = u16::from(b'"');
    let mut slashes = 0;
    out.push(quote);
    for unit in value.encode_wide() {
        if unit == 0 || out.len() + slashes > 32_760 {
            return Err(JobError::Invalid);
        }
        if unit == slash {
            slashes += 1;
            continue;
        }
        let count = if unit == quote {
            2 * slashes + 1
        } else {
            slashes
        };
        out.extend(std::iter::repeat_n(slash, count));
        out.push(unit);
        slashes = 0;
    }
    out.extend(std::iter::repeat_n(slash, 2 * slashes));
    out.push(quote);
    Ok(())
}

fn environment_block(environment: &BTreeMap<OsString, OsString>) -> Result<Vec<u16>, JobError> {
    let mut entries = BTreeMap::new();
    for (name, value) in environment {
        let name = name
            .to_str()
            .filter(|key| {
                key.as_bytes()
                    .first()
                    .is_some_and(|byte| byte.is_ascii_alphabetic() || *byte == b'_')
                    && key
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
            })
            .ok_or(JobError::Invalid)?;
        if entries
            .insert(name.to_ascii_uppercase(), (name, value))
            .is_some()
        {
            return Err(JobError::Invalid);
        }
    }
    let mut result = Vec::new();
    for (_, (name, value)) in entries {
        result.extend(name.encode_utf16());
        result.push(u16::from(b'='));
        result.extend(wide(value)?);
        if result.len() > 65_536 {
            return Err(JobError::Invalid);
        }
    }
    if result.is_empty() {
        result.push(0);
    }
    result.push(0);
    Ok(result)
}
