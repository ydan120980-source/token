use super::{JobError, JobProcess, OwnedHandle, StartOptions};
use std::{
    ffi::c_void,
    mem::size_of,
    time::{Duration, Instant},
};
use windows::Win32::{
    Foundation::{ERROR_BROKEN_PIPE, ERROR_PIPE_NOT_CONNECTED, HANDLE},
    Security::SECURITY_ATTRIBUTES,
    Storage::FileSystem::{ReadFile, WriteFile},
    System::{
        Pipes::{CreatePipe, PeekNamedPipe},
        Threading::{
            DeleteProcThreadAttributeList, InitializeProcThreadAttributeList,
            UpdateProcThreadAttribute, LPPROC_THREAD_ATTRIBUTE_LIST,
            PROC_THREAD_ATTRIBUTE_HANDLE_LIST, PROC_THREAD_ATTRIBUTE_JOB_LIST,
            STARTF_USESTDHANDLES, STARTUPINFOEXW,
        },
    },
};

struct AttributeList<'a> {
    list: LPPROC_THREAD_ATTRIBUTE_LIST,
    _storage: Vec<usize>,
    _handles: &'a [HANDLE],
    _jobs: &'a [HANDLE; 1],
}

impl<'a> AttributeList<'a> {
    fn new(handles: &'a [HANDLE], jobs: &'a [HANDLE; 1]) -> Result<Self, JobError> {
        let mut size = 0;
        let count = if handles.is_empty() { 1 } else { 2 };
        // SAFETY: With no list buffer the API only writes the required byte count.
        let _ = unsafe { InitializeProcThreadAttributeList(None, count, None, &mut size) };
        if size == 0 {
            return Err(JobError::HostUnavailable);
        }
        let mut storage = vec![0usize; size.div_ceil(size_of::<usize>())];
        let list = LPPROC_THREAD_ATTRIBUTE_LIST(storage.as_mut_ptr().cast());
        // SAFETY: storage is an aligned writable allocation of at least size bytes.
        unsafe { InitializeProcThreadAttributeList(Some(list), count, None, &mut size) }
            .map_err(|_| JobError::HostUnavailable)?;
        let list = Self {
            list,
            _storage: storage,
            _handles: handles,
            _jobs: jobs,
        };
        for (key, buffer) in [
            (PROC_THREAD_ATTRIBUTE_HANDLE_LIST, handles),
            (PROC_THREAD_ATTRIBUTE_JOB_LIST, jobs.as_slice()),
        ] {
            if buffer.is_empty() {
                continue;
            }
            // SAFETY: The list is initialized. Both handle arrays are borrowed
            // by the guard until DeleteProcThreadAttributeList releases the list.
            unsafe {
                UpdateProcThreadAttribute(
                    list.list,
                    0,
                    key as usize,
                    Some(buffer.as_ptr().cast::<c_void>()),
                    std::mem::size_of_val(buffer),
                    None,
                    None,
                )
            }
            .map_err(|_| JobError::HostUnavailable)?;
        }
        Ok(list)
    }
}
impl Drop for AttributeList<'_> {
    fn drop(&mut self) {
        // SAFETY: One successful initialization owns this attribute list.
        unsafe { DeleteProcThreadAttributeList(self.list) };
    }
}

pub(super) struct Capture {
    handles: Vec<HANDLE>,
    input: OwnedHandle,
    input_writer: Option<OwnedHandle>,
    errors: Option<(OwnedHandle, OwnedHandle)>,
    reader: OwnedHandle,
    writer: OwnedHandle,
}

pub(super) struct Startup<'a> {
    pub(super) info: STARTUPINFOEXW,
    _attributes: AttributeList<'a>,
}

impl<'a> Startup<'a> {
    pub(super) fn console(jobs: &'a [HANDLE; 1]) -> Result<Self, JobError> {
        let attributes = AttributeList::new(&[], jobs)?;
        let mut info = STARTUPINFOEXW::default();
        info.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
        info.lpAttributeList = attributes.list;
        Ok(Self {
            info,
            _attributes: attributes,
        })
    }
}

fn pipe() -> Result<(OwnedHandle, OwnedHandle), JobError> {
    let mut reader = HANDLE::default();
    let mut writer = HANDLE::default();
    let attributes = SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        bInheritHandle: true.into(),
        ..Default::default()
    };
    // SAFETY: outputs are live writable handles and attributes is initialized.
    unsafe { CreatePipe(&mut reader, &mut writer, Some(&attributes), 8192) }
        .map_err(|_| JobError::HostUnavailable)?;
    Ok((OwnedHandle(reader), OwnedHandle(writer)))
}

impl Capture {
    pub(super) fn new(interactive: bool) -> Result<Self, JobError> {
        let (input, input_writer) = pipe()?;
        let input_writer = interactive.then_some(input_writer);
        let (reader, writer) = pipe()?;
        let mut handles = vec![input.0, writer.0];
        let errors = if interactive {
            let (read, write) = pipe()?;
            handles.push(write.0);
            Some((read, write))
        } else {
            None
        };
        Ok(Self {
            handles,
            input,
            input_writer,
            errors,
            reader,
            writer,
        })
    }

    pub(super) fn startup<'a>(&'a self, jobs: &'a [HANDLE; 1]) -> Result<Startup<'a>, JobError> {
        let attributes = AttributeList::new(&self.handles, jobs)?;
        let mut info = STARTUPINFOEXW::default();
        info.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
        info.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        info.StartupInfo.hStdInput = self.input.0;
        info.StartupInfo.hStdOutput = self.writer.0;
        info.StartupInfo.hStdError = self
            .errors
            .as_ref()
            .map_or(self.writer.0, |(_, write)| write.0);
        info.lpAttributeList = attributes.list;
        Ok(Startup {
            info,
            _attributes: attributes,
        })
    }

    pub(super) fn reader(self) -> OwnedHandle {
        self.reader
    }
}

fn closed(error: &windows::core::Error) -> bool {
    let code = error.code();
    code == windows::core::HRESULT::from_win32(ERROR_BROKEN_PIPE.0)
        || code == windows::core::HRESULT::from_win32(ERROR_PIPE_NOT_CONNECTED.0)
}

fn read_available(
    pipe: &OwnedHandle,
    output: &mut Vec<u8>,
    limit: usize,
) -> Result<bool, JobError> {
    let mut available = 0;
    // SAFETY: pipe is owned and readable. Only the count pointer is used.
    match unsafe { PeekNamedPipe(pipe.0, None, 0, None, Some(&mut available), None) } {
        Ok(()) => {}
        Err(error) if closed(&error) => return Ok(false),
        Err(_) => return Err(JobError::HostUnavailable),
    }
    if available == 0 {
        return Ok(false);
    }
    if (available as usize).saturating_add(output.len()) > limit {
        return Err(JobError::OutputLimit);
    }
    let mut buffer = [0; 8192];
    let length = (available as usize).min(buffer.len());
    let mut count = 0;
    // SAFETY: There is one consumer. PeekNamedPipe reported bytes already
    // queued, so this bounded call cannot wait for the child to produce data.
    unsafe { ReadFile(pipe.0, Some(&mut buffer[..length]), Some(&mut count), None) }
        .map_err(|_| JobError::HostUnavailable)?;
    output.extend_from_slice(&buffer[..count as usize]);
    Ok(count != 0)
}

/// A pinned job with one owner for the three stdio pipes.
pub struct LineSession {
    job: JobProcess,
    input: OwnedHandle,
    output: OwnedHandle,
    errors: OwnedHandle,
    buffer: zeroize::Zeroizing<Vec<u8>>,
    sent: usize,
}

impl LineSession {
    pub(super) fn start(
        pin: &super::ExecutablePin,
        options: StartOptions<'_>,
    ) -> Result<Self, JobError> {
        let mut capture = Capture::new(true)?;
        let job = JobProcess::start_inner(pin, options, Some(&capture), false)?;
        let input = capture
            .input_writer
            .take()
            .ok_or(JobError::HostUnavailable)?;
        let (errors, child_errors) = capture.errors.take().ok_or(JobError::HostUnavailable)?;
        drop(child_errors);
        Ok(Self {
            job,
            input,
            output: capture.reader(),
            errors,
            buffer: Default::default(),
            sent: 0,
        })
    }

    pub fn send(&mut self, line: &[u8]) -> Result<(), JobError> {
        if line.is_empty()
            || line.len() > 2048
            || self.sent + line.len() > 4096
            || !line.ends_with(b"\n")
        {
            return Err(JobError::Invalid);
        }
        let mut written = 0;
        // SAFETY: This guard owns the writable pipe. A caller has at most one
        // outstanding small request in the 8 KiB stdin buffer.
        unsafe { WriteFile(self.input.0, Some(line), Some(&mut written), None) }
            .map_err(|_| JobError::HostUnavailable)?;
        if written as usize != line.len() {
            return Err(JobError::HostUnavailable);
        }
        self.sent += written as usize;
        Ok(())
    }

    pub fn next_line(
        &mut self,
        deadline: Instant,
        canceled: impl Fn() -> bool,
    ) -> Result<zeroize::Zeroizing<Vec<u8>>, JobError> {
        use zeroize::Zeroize;
        let mut ignored = zeroize::Zeroizing::new(Vec::new());
        loop {
            if canceled() {
                return Err(JobError::Canceled);
            }
            if Instant::now() >= deadline {
                return Err(JobError::TimedOut);
            }
            if let Some(end) = self.buffer.iter().position(|byte| *byte == b'\n') {
                let remaining = zeroize::Zeroizing::new(self.buffer.split_off(end + 1));
                return Ok(std::mem::replace(&mut self.buffer, remaining));
            }
            if read_available(&self.errors, &mut ignored, 512 * 1024)? {
                ignored.zeroize();
            }
            let read = read_available(&self.output, &mut self.buffer, 512 * 1024)?;
            if !read && self.job.wait(Duration::from_millis(12))?.is_some() {
                return Err(JobError::HostUnavailable);
            }
        }
    }
}

#[derive(Debug)]
pub struct JobOutput {
    pub code: u32,
    pub stdout: Vec<u8>,
}

pub(super) fn run(
    pin: &super::ExecutablePin,
    options: StartOptions<'_>,
    timeout: Duration,
    limit: usize,
    is_canceled: impl Fn() -> bool,
) -> Result<JobOutput, JobError> {
    if is_canceled() {
        return Err(JobError::Canceled);
    }
    if timeout.is_zero() || timeout > Duration::from_secs(900) || limit > 512 * 1024 {
        return Err(JobError::Invalid);
    }
    let capture = Capture::new(false)?;
    let job = JobProcess::start_inner(pin, options, Some(&capture), false)?;
    let pipe = capture.reader();
    let mut stdout = Vec::new();
    let deadline = Instant::now() + timeout;
    let result = loop {
        if is_canceled() {
            break Err(JobError::Canceled);
        }
        if Instant::now() >= deadline {
            break Err(JobError::TimedOut);
        }
        let available = match read_available(&pipe, &mut stdout, limit) {
            Ok(value) => value,
            Err(error) => break Err(error),
        };
        match job.wait(if available {
            Duration::ZERO
        } else {
            Duration::from_millis(12)
        }) {
            Ok(Some(code)) if !available => break Ok(code),
            Ok(_) => {}
            Err(error) => break Err(error),
        }
    };
    job.reap()?;
    let code = result?;
    while read_available(&pipe, &mut stdout, limit)? {}
    Ok(JobOutput { code, stdout })
}
