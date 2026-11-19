pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn iso_from_ms(ms: i64) -> String {
    let days = ms.div_euclid(86_400_000);
    let rem = ms.rem_euclid(86_400_000);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3_600_000,
        (rem % 3_600_000) / 60_000,
        (rem % 60_000) / 1000,
        rem % 1000
    )
}

pub fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let mp = if month > 2 { month - 3 } else { month + 9 } as i64;
    let doy = (153 * mp + 2) / 5 + day as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

// Bounded ISO-8601 parser matching the shapes the Agents write (date-only,
// local or zoned date-time, millisecond fraction). Anything else stays null.
pub fn parse_iso(text: &str) -> Option<i64> {
    let bytes = text.as_bytes();
    if bytes.len() < 10 {
        return None;
    }
    let num = |r: std::ops::Range<usize>| -> Option<i64> {
        let part = text.get(r)?;
        if part.bytes().all(|b| b.is_ascii_digit()) {
            part.parse().ok()
        } else {
            None
        }
    };
    if bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    let year = num(0..4)?;
    let month = num(5..7)?;
    let day = num(8..10)?;
    if !(1..=12).contains(&month) || day < 1 || day > 31 {
        return None;
    }
    let mut ms = days_from_civil(year, month as u32, day as u32) * 86_400_000;
    let mut zone_minutes: i64 = 0;
    if bytes.len() > 10 {
        if bytes[10] != b'T' && bytes[10] != b't' && bytes[10] != b' ' {
            return None;
        }
        if bytes.len() < 19 || bytes[13] != b':' || bytes[16] != b':' {
            return None;
        }
        let hour = num(11..13)?;
        let minute = num(14..16)?;
        let second = num(17..19)?;
        if hour > 23 || minute > 59 || second > 59 {
            return None;
        }
        ms += hour * 3_600_000 + minute * 60_000 + second * 1000;
        let mut at = 19;
        if bytes.get(at) == Some(&b'.') || bytes.get(at) == Some(&b',') {
            at += 1;
            let start = at;
            while bytes.get(at).map(|b| b.is_ascii_digit()).unwrap_or(false) {
                at += 1;
            }
            if at == start {
                return None;
            }
            let fraction = &text[start..at.min(start + 3)];
            let mut padded = fraction.to_string();
            while padded.len() < 3 {
                padded.push('0');
            }
            ms += padded.parse::<i64>().ok()?;
        }
        match bytes.get(at) {
            None => {}
            Some(b'Z') | Some(b'z') => {
                if at + 1 != bytes.len() {
                    return None;
                }
            }
            Some(b'+') | Some(b'-') => {
                let sign = if bytes[at] == b'-' { -1 } else { 1 };
                let rest = &text[at + 1..];
                let (zh, zm) = match rest.len() {
                    5 if rest.as_bytes()[2] == b':' => (rest.get(0..2)?.parse::<i64>().ok()?, rest.get(3..5)?.parse::<i64>().ok()?),
                    4 => (rest.get(0..2)?.parse::<i64>().ok()?, rest.get(2..4)?.parse::<i64>().ok()?),
                    2 => (rest.parse::<i64>().ok()?, 0),
                    _ => return None,
                };
                if zh > 23 || zm > 59 {
                    return None;
                }
                zone_minutes = sign * (zh * 60 + zm);
            }
            _ => return None,
        }
    }
    let ms = ms - zone_minutes * 60_000;
    if ms.abs() > 8_640_000_000_000_000 {
        return None;
    }
    Some(ms)
}