#![cfg(windows)]

use quota_engine::dpapi::{protect, unprotect};

#[test]
fn current_user_can_reopen_synthetic_bytes_only_with_the_matching_purpose(
) -> Result<(), Box<dyn std::error::Error>> {
    let plaintext = b"synthetic provider record";
    let purpose = b"quotadock:synthetic:test";
    let mut protected = protect(plaintext, purpose)?;
    assert!(!protected
        .windows(plaintext.len())
        .any(|bytes| bytes == plaintext));
    assert_eq!(unprotect(&protected, purpose)?.as_ref(), plaintext);
    assert!(unprotect(&protected, b"quotadock:other").is_err());
    if let Some(first) = protected.first_mut() {
        *first ^= 0xff;
    }
    assert!(unprotect(&protected, purpose).is_err());
    Ok(())
}
