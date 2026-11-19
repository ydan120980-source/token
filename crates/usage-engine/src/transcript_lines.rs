use same_file::Handle;
use serde_json::Value;
use std::{
    fmt,
    fs::{self, File, Metadata, OpenOptions},
    io::{self, BufRead, BufReader, Read, Seek, SeekFrom},
    ops::ControlFlow,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const CHUNK: usize = 256 * 1024;

#[derive(Debug)]
pub enum LineError {
    SizeOrLink,
    Busy,
    InvalidOffset,
    Io(io::Error),
}

impl fmt::Display for LineError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SizeOrLink => formatter.write_str("SOURCE_SIZE_OR_LINK"),
            Self::Busy => formatter.write_str("SOURCE_BUSY"),
            Self::InvalidOffset => formatter.write_str("TRANSCRIPT_PART_INVALID"),
            Self::Io(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for LineError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            _ => None,
        }
    }
}

impl From<io::Error> for LineError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

/// A byte range in the current, request-local source generation, including its LF if present.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LineSpan {
    pub offset: u64,
    pub length: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SourceEpoch {
    pub length: u64,
    pub modified: SystemTime,
    created: Option<SystemTime>,
}

impl SourceEpoch {
    fn from_metadata(meta: &Metadata) -> io::Result<Self> {
        Ok(Self {
            length: meta.len(),
            modified: meta.modified()?,
            created: meta.created().ok(),
        })
    }

    pub(crate) fn rounded_ms(&self) -> i64 {
        let nanos = match self.modified.duration_since(UNIX_EPOCH) {
            Ok(duration) => duration.as_nanos() as i128,
            Err(error) => -(error.duration().as_nanos() as i128),
        };
        ((nanos + 500_000).div_euclid(1_000_000)) as i64
    }
}

pub(crate) fn epoch(path: &Path) -> Result<SourceEpoch, LineError> {
    let meta = fs::symlink_metadata(path)?;
    if !regular(&meta) {
        return Err(LineError::SizeOrLink);
    }
    Ok(SourceEpoch::from_metadata(&meta)?)
}

/// One buffered reader over a policy-approved source path. No parsed rows are retained.
pub struct JsonlReader {
    path: PathBuf,
    identity: Handle,
    before: Metadata,
    generation: SourceEpoch,
    reader: Input,
    offset: u64,
    line: Vec<u8>,
    limit: u64,
}

enum Input {
    Plain(BufReader<File>),
    Compressed {
        stream: Box<dyn BufRead>,
        complete: u64,
    },
}

impl Input {
    fn buffered(&mut self) -> &mut dyn BufRead {
        match self {
            Self::Plain(file) => file,
            Self::Compressed { stream, .. } => &mut **stream,
        }
    }

    fn decoded(file: &File, complete: u64) -> io::Result<Box<dyn BufRead>> {
        let mut file = file.try_clone()?;
        file.seek(SeekFrom::Start(0))?;
        let input = file.take(complete);
        if complete == 0 {
            return Ok(Box::new(BufReader::new(input)));
        }
        let mut decoder = zstd::stream::read::Decoder::new(input)?;
        decoder.window_log_max(29)?;
        Ok(Box::new(BufReader::with_capacity(CHUNK, decoder)))
    }
}

fn regular(metadata: &Metadata) -> bool {
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return false;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return false;
        }
    }
    true
}

fn open_regular(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x00200000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    options.open(path)
}

fn same_snapshot(first: &Metadata, second: &Metadata) -> bool {
    regular(second)
        && first.len() == second.len()
        && matches!((first.modified(), second.modified()), (Ok(first), Ok(second)) if first == second)
}

impl JsonlReader {
    /// Open a bounded JSONL file without following file links on Windows.
    pub fn open(path: &Path, max_bytes: u64) -> Result<Self, LineError> {
        let before = fs::symlink_metadata(path)?;
        if !regular(&before) || before.len() > max_bytes {
            return Err(LineError::SizeOrLink);
        }
        let file = open_regular(path)?;
        let generation = SourceEpoch::from_metadata(&before)?;
        let identity = Handle::from_file(file.try_clone()?)?;
        let reader = Self {
            path: path.to_owned(),
            identity,
            before,
            generation,
            reader: Input::Plain(BufReader::with_capacity(CHUNK, file)),
            offset: 0,
            line: Vec::new(),
            limit: generation.length,
        };
        reader.verify()?;
        Ok(reader)
    }

    pub(crate) fn open_compressed(path: &Path, max_bytes: u64) -> Result<Self, LineError> {
        let mut reader = Self::open(path, max_bytes)?;
        let Input::Plain(file) = &mut reader.reader else {
            return Err(LineError::SizeOrLink);
        };
        let complete = crate::zstd_frame::complete_frames(file, reader.generation.length)?;
        reader.reader = Input::Compressed {
            stream: Input::decoded(reader.identity.as_file(), complete)?,
            complete,
        };
        reader.limit = max_bytes;
        reader.verify()?;
        Ok(reader)
    }

    pub(crate) fn epoch(&self) -> SourceEpoch {
        self.generation
    }

    pub(crate) fn rewind(&mut self) -> Result<(), LineError> {
        self.seek_to(0)
    }

    pub(crate) fn read_prefix(&mut self, bytes: usize) -> Result<Vec<u8>, LineError> {
        self.rewind()?;
        let mut prefix = Vec::with_capacity(bytes);
        self.reader
            .buffered()
            .take(self.generation.length.min(bytes as u64))
            .read_to_end(&mut prefix)?;
        self.verify()?;
        self.offset = prefix.len() as u64;
        Ok(prefix)
    }

    pub(crate) fn read_document(&mut self) -> Result<Option<Value>, LineError> {
        self.rewind()?;
        let length = self.generation.length;
        let mut input = self.reader.buffered().take(length);
        let mut decoded = serde_json::Deserializer::from_reader(&mut input);
        use serde::Deserialize;
        let value = Value::deserialize(&mut decoded)
            .and_then(|value| {
                decoded.end()?;
                Ok(value)
            })
            .ok();
        self.offset = length - input.limit();
        self.verify()?;
        Ok(value)
    }

    pub(crate) fn contains_folded(
        &mut self,
        forms: &[String],
        mut remaining: impl FnMut() -> bool,
    ) -> Result<bool, LineError> {
        self.rewind()?;
        let overlap = forms
            .iter()
            .map(String::len)
            .max()
            .unwrap_or_default()
            .saturating_mul(4)
            + 8;
        let mut tail = Vec::with_capacity(overlap);
        let mut buffer = Vec::with_capacity(CHUNK + overlap);
        let mut input = self.reader.buffered().take(self.generation.length);
        let mut found = false;
        while remaining() {
            let bytes = input.fill_buf()?;
            if bytes.is_empty() {
                break;
            }
            buffer.clear();
            buffer.extend_from_slice(&tail);
            buffer.extend_from_slice(bytes);
            let text = String::from_utf8_lossy(&buffer).to_lowercase();
            if forms.iter().any(|form| text.contains(form)) {
                found = true;
                break;
            }
            tail.clear();
            tail.extend_from_slice(&buffer[buffer.len().saturating_sub(overlap)..]);
            let length = bytes.len();
            input.consume(length);
        }
        self.verify()?;
        Ok(found)
    }

    /// Check identity and metadata using both the live handle and the current path.
    pub fn verify(&self) -> Result<(), LineError> {
        let live = self
            .identity
            .as_file()
            .metadata()
            .map_err(|_| LineError::Busy)?;
        let named = fs::symlink_metadata(&self.path).map_err(|_| LineError::Busy)?;
        if !same_snapshot(&self.before, &live) || !same_snapshot(&self.before, &named) {
            return Err(LineError::Busy);
        }
        let current = Handle::from_file(open_regular(&self.path).map_err(|_| LineError::Busy)?)
            .map_err(|_| LineError::Busy)?;
        let metadata = current.as_file().metadata().map_err(|_| LineError::Busy)?;
        if current != self.identity || !same_snapshot(&self.before, &metadata) {
            return Err(LineError::Busy);
        }
        Ok(())
    }

    fn next_line(&mut self) -> Result<Option<LineSpan>, LineError> {
        let compressed = matches!(self.reader, Input::Compressed { .. });
        let remaining = self.limit - self.offset;
        if remaining == 0 {
            if compressed {
                return Err(LineError::SizeOrLink);
            }
            return Ok(None);
        }
        self.line.clear();
        let offset = self.offset;
        let count = self
            .reader
            .buffered()
            .take(remaining)
            .read_until(b'\n', &mut self.line)?;
        if count == 0 {
            if compressed {
                return Ok(None);
            }
            return Err(LineError::Busy);
        }
        if compressed && count as u64 == remaining {
            return Err(LineError::SizeOrLink);
        }
        self.offset += count as u64;
        if self.line.last() == Some(&b'\n') {
            self.line.pop();
        }
        Ok(Some(LineSpan {
            offset,
            length: count as u64,
        }))
    }

    /// Visit every physical line, including malformed JSON. Verify the source even after an early stop.
    pub fn visit(
        &mut self,
        mut visitor: impl FnMut(LineSpan, &str, Option<Value>) -> ControlFlow<()>,
    ) -> Result<(), LineError> {
        let result = (|| {
            while let Some(span) = self.next_line()? {
                let line = String::from_utf8_lossy(&self.line);
                let decoded = serde_json::from_str(&line).ok();
                if visitor(span, &line, decoded).is_break() {
                    break;
                }
            }
            Ok(())
        })();
        self.verify()?;
        result
    }

    /// Recover one indexed row without walking or decoding earlier rows.
    pub fn read_at(&mut self, span: LineSpan) -> Result<Option<Value>, LineError> {
        self.verify()?;
        let result = self.read_indexed(span);
        self.verify()?;
        result
    }

    pub(crate) fn read_indexed(&mut self, span: LineSpan) -> Result<Option<Value>, LineError> {
        if span.length == 0
            || span
                .offset
                .checked_add(span.length)
                .is_none_or(|end| end > self.limit)
        {
            return Err(LineError::InvalidOffset);
        }
        if self.offset != span.offset {
            self.seek_to(span.offset)?;
        }
        if self.next_line()? != Some(span) {
            return Err(LineError::InvalidOffset);
        }
        Ok(serde_json::from_str(&String::from_utf8_lossy(&self.line)).ok())
    }

    fn seek_to(&mut self, target: u64) -> Result<(), LineError> {
        match &mut self.reader {
            Input::Plain(file) => {
                file.seek(SeekFrom::Start(target))?;
            }
            Input::Compressed { stream, complete } => {
                let mut offset = self.offset;
                if target < offset || target == 0 {
                    *stream = Input::decoded(self.identity.as_file(), *complete)?;
                    offset = 0;
                }
                while offset < target {
                    let data = stream.fill_buf()?;
                    if data.is_empty() {
                        return Err(LineError::InvalidOffset);
                    }
                    let count = (target - offset).min(data.len() as u64) as usize;
                    stream.consume(count);
                    offset += count as u64;
                }
            }
        }
        self.offset = target;
        Ok(())
    }
}
