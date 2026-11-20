use std::{io, os::windows::ffi::OsStrExt, path::Path};
use windows::{
    core::{w, PCWSTR},
    Win32::{
        Foundation::{ERROR_FILE_NOT_FOUND, ERROR_MORE_DATA, ERROR_SUCCESS, WIN32_ERROR},
        System::Registry::{
            RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegGetValueW, RegSetValueExW, HKEY,
            HKEY_CURRENT_USER, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_SZ, RRF_RT_REG_SZ,
        },
    },
};

const RUN: PCWSTR = w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run");
const NAME: PCWSTR = w!("dev.quotadock.reader");
pub const START_IN_TRAY: &str = "--start-in-tray";

pub struct StartupRegistration {
    command: Vec<u16>,
}

struct RunKey(HKEY);

impl Drop for RunKey {
    fn drop(&mut self) {
        // SAFETY: Only a successful RegCreateKeyExW constructs this owned key.
        let _ = unsafe { RegCloseKey(self.0) };
    }
}

fn result(status: WIN32_ERROR) -> io::Result<()> {
    if status == ERROR_SUCCESS {
        Ok(())
    } else {
        Err(io::Error::from_raw_os_error(status.0 as i32))
    }
}

impl StartupRegistration {
    pub fn new(executable: &Path) -> Option<Self> {
        if !executable.is_absolute() {
            return None;
        }
        let mut command = vec![b'"' as u16];
        for value in executable.as_os_str().encode_wide() {
            if value == 0 || value == b'"' as u16 {
                return None;
            }
            command.push(value);
        }
        command.extend(format!("\" {START_IN_TRAY}\0").encode_utf16());
        // Windows Run entries allow a command line of up to 260 characters.
        (command.len() <= 261).then_some(Self { command })
    }

    pub fn enabled(&self) -> io::Result<bool> {
        let mut value = vec![0u16; self.command.len()];
        let mut bytes = (value.len() * 2) as u32;
        // SAFETY: The subkey and value are static, terminated strings. The
        // buffer is writable for exactly its declared length.
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                RUN,
                NAME,
                RRF_RT_REG_SZ,
                None,
                Some(value.as_mut_ptr().cast()),
                Some(&mut bytes),
            )
        };
        if status == ERROR_FILE_NOT_FOUND || status == ERROR_MORE_DATA {
            return Ok(false);
        }
        result(status)?;
        Ok(bytes as usize == self.command.len() * 2 && value == self.command)
    }

    pub fn set(&self, enabled: bool) -> io::Result<()> {
        let mut key = HKEY::default();
        // SAFETY: Windows owns the root key. The returned writable key is
        // closed by RunKey, and the subkey name is static and terminated.
        result(unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                RUN,
                None,
                PCWSTR::null(),
                REG_OPTION_NON_VOLATILE,
                KEY_SET_VALUE,
                None,
                &mut key,
                None,
            )
        })?;
        let key = RunKey(key);
        if enabled {
            let bytes: Vec<u8> = self
                .command
                .iter()
                .flat_map(|value| value.to_le_bytes())
                .collect();
            // SAFETY: The key has SET_VALUE rights and REG_SZ receives the
            // complete terminated UTF-16 buffer as bytes.
            result(unsafe { RegSetValueExW(key.0, NAME, None, REG_SZ, Some(&bytes)) })
        } else {
            // SAFETY: The owned key is writable and the name is terminated.
            let status = unsafe { RegDeleteValueW(key.0, NAME) };
            if status == ERROR_FILE_NOT_FOUND {
                Ok(())
            } else {
                result(status)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registration_quotes_the_executable_and_requests_a_cold_tray() {
        let startup =
            StartupRegistration::new(Path::new(r"C:\Program Files\QuotaDock\QuotaDock.exe"))
                .expect("valid executable path");
        assert_eq!(
            String::from_utf16_lossy(&startup.command),
            "\"C:\\Program Files\\QuotaDock\\QuotaDock.exe\" --start-in-tray\0"
        );
        assert!(StartupRegistration::new(Path::new("QuotaDock.exe")).is_none());
    }
}
