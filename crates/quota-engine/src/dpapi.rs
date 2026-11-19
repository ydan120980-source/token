use std::{fmt, ptr, slice};
use windows::{
    core::PCWSTR,
    Win32::{
        Foundation::{LocalFree, HLOCAL},
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    },
};
use zeroize::{Zeroize, Zeroizing};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DpapiError;

impl fmt::Display for DpapiError {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        out.write_str("PROVIDER_SECURE_STORAGE_FAILED")
    }
}

impl std::error::Error for DpapiError {}

/// Decrypted bytes are zeroized on drop and do not implement Debug.
pub struct Plaintext(Zeroizing<Vec<u8>>);

impl AsRef<[u8]> for Plaintext {
    fn as_ref(&self) -> &[u8] {
        self.0.as_slice()
    }
}

struct LocalBlob(CRYPT_INTEGER_BLOB);

impl LocalBlob {
    fn new() -> Self {
        Self(CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: ptr::null_mut(),
        })
    }

    fn bytes(&self) -> Result<&[u8], DpapiError> {
        let size = self.0.cbData as usize;
        if size == 0 {
            return Ok(&[]);
        }
        if self.0.pbData.is_null() || size > isize::MAX as usize {
            return Err(DpapiError);
        }
        // SAFETY: A successful DPAPI call returns a LocalAlloc allocation with
        // cbData initialized bytes. This guard owns the allocation and lends it.
        Ok(unsafe { slice::from_raw_parts(self.0.pbData, size) })
    }
}

impl Drop for LocalBlob {
    fn drop(&mut self) {
        if self.0.pbData.is_null() {
            return;
        }
        let size = self.0.cbData as usize;
        // SAFETY: The pointer is the DPAPI output allocated by the system.
        // This is its sole owning guard. Wipe the validated byte range before
        // releasing exactly this allocation with the matching LocalFree call.
        unsafe {
            if size > 0 && size <= isize::MAX as usize {
                slice::from_raw_parts_mut(self.0.pbData, size).zeroize();
            }
            let _ = LocalFree(Some(HLOCAL(self.0.pbData.cast())));
        }
    }
}

fn input(bytes: &[u8]) -> Result<CRYPT_INTEGER_BLOB, DpapiError> {
    let size = u32::try_from(bytes.len()).map_err(|_| DpapiError)?;
    Ok(CRYPT_INTEGER_BLOB {
        cbData: size,
        pbData: bytes.as_ptr().cast_mut(),
    })
}

/// Uses the current Windows user's DPAPI key. The caller can bind the bytes to
/// a stable storage purpose by supplying the same entropy when opening them.
pub fn protect(plain: &[u8], purpose: &[u8]) -> Result<Vec<u8>, DpapiError> {
    let plain = input(plain)?;
    let entropy = input(purpose)?;
    let mut output = LocalBlob::new();
    // SAFETY: Input and optional entropy borrow live read-only slices; only
    // output.0 is mutated. No description, reserved pointer or UI is supplied.
    unsafe {
        CryptProtectData(
            &plain,
            PCWSTR::null(),
            (!purpose.is_empty()).then_some(&entropy),
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output.0,
        )
    }
    .map_err(|_| DpapiError)?;
    Ok(output.bytes()?.to_vec())
}

pub fn unprotect(ciphertext: &[u8], purpose: &[u8]) -> Result<Plaintext, DpapiError> {
    let encrypted = input(ciphertext)?;
    let entropy = input(purpose)?;
    let mut output = LocalBlob::new();
    // SAFETY: Both input blobs borrow readable bytes for the call. DPAPI writes
    // into output.0. Optional description, reserved and UI pointers are null.
    unsafe {
        CryptUnprotectData(
            &encrypted,
            None,
            (!purpose.is_empty()).then_some(&entropy),
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output.0,
        )
    }
    .map_err(|_| DpapiError)?;
    Ok(Plaintext(Zeroizing::new(output.bytes()?.to_vec())))
}
