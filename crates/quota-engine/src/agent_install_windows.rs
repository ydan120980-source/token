use crate::{agent_install_plans::version, windows_job::ExecutablePin};
use std::{
    ffi::c_void,
    fs,
    mem::size_of,
    os::windows::{ffi::OsStrExt, fs::OpenOptionsExt, io::AsRawHandle},
    path::{Path, PathBuf},
    ptr, slice,
};
use usage_engine::config_health::guard;
use windows::{
    core::{w, GUID, PCWSTR},
    Win32::{
        Foundation::{HANDLE, HWND},
        Security::{
            Cryptography::{CertGetNameStringW, CERT_NAME_SIMPLE_DISPLAY_TYPE},
            WinTrust::{
                WTHelperGetProvCertFromChain, WTHelperGetProvSignerFromChain,
                WTHelperProvDataFromStateData, WinVerifyTrust, WINTRUST_ACTION_GENERIC_VERIFY_V2,
                WINTRUST_DATA, WINTRUST_DATA_0, WINTRUST_FILE_INFO, WTD_CACHE_ONLY_URL_RETRIEVAL,
                WTD_CHOICE_FILE, WTD_STATEACTION_CLOSE, WTD_STATEACTION_VERIFY, WTD_UI_NONE,
            },
        },
        Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW},
        System::Registry::{RegGetValueW, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ},
    },
};
const SIGNATURE: &str = "INSTALL_SIGNATURE_FAILED";

fn native(path: &Path) -> Option<Vec<u16>> {
    let mut chars: Vec<u16> = path.as_os_str().encode_wide().collect();
    if chars.contains(&0) {
        return None;
    }
    chars.push(0);
    Some(chars)
}

struct TrustedImage<'a> {
    data: WINTRUST_DATA,
    action: GUID,
    _file: &'a mut WINTRUST_FILE_INFO,
}

impl<'a> TrustedImage<'a> {
    fn new(file: &'a mut WINTRUST_FILE_INFO) -> Result<Self, &'static str> {
        let mut trust = Self {
            data: WINTRUST_DATA {
                cbStruct: size_of::<WINTRUST_DATA>() as u32,
                dwUIChoice: WTD_UI_NONE,
                dwUnionChoice: WTD_CHOICE_FILE,
                Anonymous: WINTRUST_DATA_0 { pFile: file },
                dwStateAction: WTD_STATEACTION_VERIFY,
                dwProvFlags: WTD_CACHE_ONLY_URL_RETRIEVAL,
                ..Default::default()
            },
            action: WINTRUST_ACTION_GENERIC_VERIFY_V2,
            _file: file,
        };
        // SAFETY: This guard borrows the initialized file record and the
        // call uses a writable request. Drop releases any verification state.
        let status = unsafe {
            WinVerifyTrust(
                HWND::default(),
                &mut trust.action,
                (&mut trust.data as *mut WINTRUST_DATA).cast(),
            )
        };
        if status != 0 {
            return Err(SIGNATURE);
        }
        Ok(trust)
    }

    fn publisher(&self) -> Option<String> {
        // SAFETY: All provider pointers are borrowed from this guard's
        // WinVerifyTrust state and used only while the guard keeps it alive.
        let name = unsafe {
            let provider = WTHelperProvDataFromStateData(self.data.hWVTStateData);
            if provider.is_null() {
                return None;
            }
            let signer = WTHelperGetProvSignerFromChain(provider, 0, false, 0);
            if signer.is_null() {
                return None;
            }
            let certificate = WTHelperGetProvCertFromChain(signer, 0);
            let cert = certificate.as_ref()?.pCert;
            if cert.is_null() {
                return None;
            }
            let length = CertGetNameStringW(cert, CERT_NAME_SIMPLE_DISPLAY_TYPE, 0, None, None);
            if !(2..=4096).contains(&length) {
                return None;
            }
            let mut text = vec![0u16; length as usize];
            let copied = CertGetNameStringW(
                cert,
                CERT_NAME_SIMPLE_DISPLAY_TYPE,
                0,
                None,
                Some(&mut text),
            );
            if copied != length {
                return None;
            }
            text.pop();
            text
        };
        String::from_utf16(&name).ok()
    }
}

impl Drop for TrustedImage<'_> {
    fn drop(&mut self) {
        if self.data.hWVTStateData.is_invalid() {
            return;
        }
        self.data.dwStateAction = WTD_STATEACTION_CLOSE;
        // SAFETY: The verification request and borrowed file record still
        // exist. Closing once releases the state allocated by WinVerifyTrust.
        unsafe {
            WinVerifyTrust(
                HWND::default(),
                &mut self.action,
                (&mut self.data as *mut WINTRUST_DATA).cast(),
            )
        };
    }
}

pub(super) fn verify(
    path: &Path,
    publisher: &[&str],
) -> Result<(ExecutablePin, Option<String>), &'static str> {
    guard(path).map_err(|_| SIGNATURE)?;
    let file = fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .custom_flags(0x0020_0000)
        .open(path)
        .map_err(|_| SIGNATURE)?;
    let name = native(path).ok_or(SIGNATURE)?;
    let mut item = WINTRUST_FILE_INFO {
        cbStruct: size_of::<WINTRUST_FILE_INFO>() as u32,
        pcwszFilePath: PCWSTR(name.as_ptr()),
        hFile: HANDLE(file.as_raw_handle()),
        ..Default::default()
    };
    let state = TrustedImage::new(&mut item)?;
    let signer = state.publisher().ok_or(SIGNATURE)?.to_lowercase();
    if !publisher
        .iter()
        .any(|name| signer.contains(&name.to_lowercase()))
    {
        return Err(SIGNATURE);
    }
    // Use the same file while its write/delete sharing remains disabled.
    let pin = ExecutablePin::new(path).map_err(|_| SIGNATURE)?;
    Ok((pin, product_version(path)))
}

fn query(buffer: &[u32], key: PCWSTR, units: usize) -> Option<&[u8]> {
    let mut output = ptr::null_mut::<c_void>();
    let mut count = 0;
    let base = buffer.as_ptr().cast::<u8>();
    // SAFETY: Version APIs initialized the supplied buffer. Returned
    // addresses must lie inside that same allocation before being used.
    if !unsafe { VerQueryValueW(base.cast(), key, &mut output, &mut count) }.as_bool()
        || output.is_null()
    {
        return None;
    }
    let offset = (output as usize).checked_sub(base as usize)?;
    let bytes = (count as usize).checked_mul(units)?;
    if offset.checked_add(bytes)? > std::mem::size_of_val(buffer) {
        return None;
    }
    // SAFETY: Both offset and length were checked against the initialized data.
    Some(unsafe { slice::from_raw_parts(base.add(offset), bytes) })
}

pub(super) fn product_version(path: &Path) -> Option<String> {
    if !path.is_absolute()
        || path.to_string_lossy().starts_with(r"\\")
        || guard(path).is_err()
        || !path.is_file()
    {
        return None;
    }
    let path = native(path)?;
    let name = PCWSTR(path.as_ptr());
    // SAFETY: The UTF-16 path has a terminator and stays valid for each call.
    let length = unsafe { GetFileVersionInfoSizeW(name, None) };
    if !(1..=1024 * 1024).contains(&length) {
        return None;
    }
    let mut data = vec![0u32; (length as usize).div_ceil(size_of::<u32>())];
    // SAFETY: The aligned allocated buffer has at least the requested capacity.
    unsafe { GetFileVersionInfoW(name, None, length, data.as_mut_ptr().cast()) }.ok()?;
    let translation = query(&data, w!("\\VarFileInfo\\Translation"), 1).unwrap_or_default();
    let locales = translation
        .chunks_exact(4)
        .take(32)
        .map(|row| {
            (
                u16::from_le_bytes([row[0], row[1]]),
                u16::from_le_bytes([row[2], row[3]]),
            )
        })
        .chain([(0x0409, 0x04b0), (0x0409, 0x04e4)]);
    for (language, code_page) in locales {
        let key: Vec<u16> =
            format!("\\StringFileInfo\\{language:04x}{code_page:04x}\\ProductVersion")
                .encode_utf16()
                .chain([0])
                .collect();
        let Some(bytes) = query(&data, PCWSTR(key.as_ptr()), 2) else {
            continue;
        };
        let words: Vec<u16> = bytes
            .chunks_exact(2)
            .take_while(|row| row != &[0, 0])
            .map(|row| u16::from_le_bytes([row[0], row[1]]))
            .collect();
        if let Ok(text) = String::from_utf16(&words) {
            if let Some(version) = version(&text) {
                return Some(version.to_owned());
            }
        }
    }
    None
}

pub(super) fn app_paths(executable: &str) -> Vec<PathBuf> {
    let key: Vec<u16> =
        format!("Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\{executable}")
            .encode_utf16()
            .chain([0])
            .collect();
    [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE]
        .into_iter()
        .filter_map(|root| {
            let mut bytes = 0;
            // SAFETY: The registry key has a terminator. The first call only
            // receives a byte length and the second receives a bounded buffer.
            let status = unsafe {
                RegGetValueW(
                    root,
                    PCWSTR(key.as_ptr()),
                    PCWSTR::null(),
                    RRF_RT_REG_SZ,
                    None,
                    None,
                    Some(&mut bytes),
                )
            };
            if status.0 != 0 || !(2..=64 * 1024).contains(&bytes) {
                return None;
            }
            let mut buffer = vec![0u16; (bytes as usize).div_ceil(2)];
            let status = unsafe {
                RegGetValueW(
                    root,
                    PCWSTR(key.as_ptr()),
                    PCWSTR::null(),
                    RRF_RT_REG_SZ,
                    None,
                    Some(buffer.as_mut_ptr().cast()),
                    Some(&mut bytes),
                )
            };
            if status.0 != 0 {
                return None;
            }
            let length = buffer.iter().position(|word| *word == 0)?;
            let value = String::from_utf16(&buffer[..length]).ok()?;
            Some(PathBuf::from(value.trim_matches('"')))
        })
        .collect()
}
