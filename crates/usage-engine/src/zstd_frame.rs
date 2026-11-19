use std::io::{self, Read, Seek, SeekFrom};

const INVALID: &str = "SOURCE_COMPRESSION_INVALID";

pub fn frame_end(bytes: &[u8], start: usize) -> Result<Option<usize>, &'static str> {
    let magic = [0x28u8, 0xb5, 0x2f, 0xfd];
    let remaining = bytes.len() - start;
    if remaining < 4 {
        if bytes[start..] != magic[..remaining] {
            return Err(INVALID);
        }
        return Ok(None);
    }
    let code = u32::from_le_bytes(bytes[start..start + 4].try_into().unwrap());
    if (0x184d2a50..=0x184d2a5f).contains(&code) {
        if remaining < 8 {
            return Ok(None);
        }
        let end = start
            + 8
            + u32::from_le_bytes(bytes[start + 4..start + 8].try_into().unwrap()) as usize;
        return Ok(if end <= bytes.len() { Some(end) } else { None });
    }
    if code != 0xfd2fb528 {
        return Err(INVALID);
    }
    if remaining < 5 {
        return Ok(None);
    }
    let descriptor = bytes[start + 4];
    let single = descriptor & 32 != 0;
    if descriptor & 8 != 0 {
        return Err(INVALID);
    }
    let content_bytes = [if single { 1 } else { 0 }, 2, 4, 8][(descriptor >> 6) as usize];
    let mut offset = start
        + 5
        + if single { 0 } else { 1 }
        + [0, 1, 2, 4][(descriptor & 3) as usize]
        + content_bytes;
    if offset > bytes.len() {
        return Ok(None);
    }
    loop {
        if offset + 3 > bytes.len() {
            return Ok(None);
        }
        let header = bytes[offset] as u32
            | (bytes[offset + 1] as u32) << 8
            | (bytes[offset + 2] as u32) << 16;
        let kind = (header >> 1) & 3;
        if kind == 3 {
            return Err(INVALID);
        }
        offset += 3 + if kind == 1 { 1 } else { (header >> 3) as usize };
        if offset > bytes.len() {
            return Ok(None);
        }
        if header & 1 != 0 {
            break;
        }
    }
    if descriptor & 4 != 0 {
        offset += 4;
    }
    Ok(if offset <= bytes.len() {
        Some(offset)
    } else {
        None
    })
}

pub(crate) fn complete_frames(reader: &mut (impl Read + Seek), length: u64) -> io::Result<u64> {
    let invalid = || io::Error::new(io::ErrorKind::InvalidData, INVALID);
    let magic = [0x28u8, 0xb5, 0x2f, 0xfd];
    let mut frame = 0;
    while frame < length {
        reader.seek(SeekFrom::Start(frame))?;
        let remaining = length - frame;
        let mut head = [0; 4];
        if remaining < 4 {
            let count = remaining as usize;
            reader.read_exact(&mut head[..count])?;
            if head[..count] != magic[..count] {
                return Err(invalid());
            }
            return Ok(frame);
        }
        reader.read_exact(&mut head)?;
        let code = u32::from_le_bytes(head);
        if (0x184d2a50..=0x184d2a5f).contains(&code) {
            if remaining < 8 {
                return Ok(frame);
            }
            reader.read_exact(&mut head)?;
            let end = frame + 8 + u64::from(u32::from_le_bytes(head));
            if end > length {
                return Ok(frame);
            }
            frame = end;
            continue;
        }
        if head != magic {
            return Err(invalid());
        }
        if remaining < 5 {
            return Ok(frame);
        }
        let mut descriptor = [0];
        reader.read_exact(&mut descriptor)?;
        let descriptor = descriptor[0];
        if descriptor & 8 != 0 {
            return Err(invalid());
        }
        let single = descriptor & 32 != 0;
        let content_bytes = [u64::from(single), 2, 4, 8][(descriptor >> 6) as usize];
        let mut offset = frame
            + 5
            + u64::from(!single)
            + [0, 1, 2, 4][(descriptor & 3) as usize]
            + content_bytes;
        loop {
            if offset + 3 > length {
                return Ok(frame);
            }
            reader.seek(SeekFrom::Start(offset))?;
            let mut bytes = [0; 4];
            reader.read_exact(&mut bytes[..3])?;
            let header = u32::from_le_bytes(bytes);
            let kind = (header >> 1) & 3;
            if kind == 3 {
                return Err(invalid());
            }
            offset += 3 + if kind == 1 { 1 } else { u64::from(header >> 3) };
            if offset > length {
                return Ok(frame);
            }
            if header & 1 != 0 {
                break;
            }
        }
        if descriptor & 4 != 0 {
            offset += 4;
        }
        if offset > length {
            return Ok(frame);
        }
        frame = offset;
    }
    Ok(frame)
}
