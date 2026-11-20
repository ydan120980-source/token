#![cfg(windows)]

use flate2::{write::GzEncoder, Compression};
use quota_engine::agent_install_archive::{tar_gzip, zip};
use std::{
    fs::{self, File},
    io::Write,
    path::Path,
};

fn write_tgz(path: &Path, entry: &str, kind: tar::EntryType, payload: &[u8]) {
    let writer = GzEncoder::new(File::create(path).expect("archive"), Compression::fast());
    let mut archive = tar::Builder::new(writer);
    let mut header = tar::Header::new_ustar();
    header.set_entry_type(kind);
    header.set_size(payload.len() as u64);
    header.set_mode(0o600);
    header.as_mut_bytes()[..entry.len()].copy_from_slice(entry.as_bytes());
    header.set_cksum();
    archive.append(&header, payload).expect("entry");
    archive
        .into_inner()
        .expect("tar end")
        .finish()
        .expect("gzip end");
}

fn write_zip(path: &Path, name: &str, payload: &[u8]) {
    let mut writer = zip::ZipWriter::new(File::create(path).expect("ZIP file"));
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    writer.start_file(name, options).expect("entry");
    writer.write_all(payload).expect("payload");
    writer.finish().expect("zip end");
}

#[test]
fn extraction_publishes_only_valid_complete_archives() {
    let fixture = tempfile::tempdir().expect("fixture");
    let tar = fixture.path().join("fixture.tgz");
    let zip_path = fixture.path().join("fixture.zip");
    let dest = fixture.path().join("validated-tar");
    let expanded = fixture.path().join("validated-zip");
    let payload = b"synthetic archive payload";
    write_tgz(&tar, "package/nested/bin", tar::EntryType::Regular, payload);
    assert_eq!(
        tar_gzip(&tar, &dest, 1024, || false)
            .expect("TAR extracted")
            .expanded_bytes,
        payload.len() as u64
    );
    assert_eq!(
        fs::read(dest.join("nested/bin")).expect("archive bytes"),
        payload
    );
    write_zip(&zip_path, "node-fixture/bin/node.exe", payload);
    assert_eq!(
        zip(&zip_path, &expanded, 1024, || false)
            .expect("ZIP extracted")
            .files,
        1
    );
    assert_eq!(
        fs::read(expanded.join("node-fixture/bin/node.exe")).expect("ZIP bytes"),
        payload
    );

    let reject = fixture.path().join("rejected");
    for unsafe_name in [
        "package/../escape",
        "package/NUL.txt",
        "package/nested/C:file",
        "package/back\\slash",
    ] {
        write_tgz(&tar, unsafe_name, tar::EntryType::Regular, payload);
        assert_eq!(
            tar_gzip(&tar, &reject, 1024, || false),
            Err("INSTALL_ARCHIVE_REJECTED")
        );
        assert!(!reject.exists());
    }
    write_tgz(&tar, "package/link", tar::EntryType::Symlink, b"");
    assert_eq!(
        tar_gzip(&tar, &reject, 1024, || false),
        Err("INSTALL_ARCHIVE_REJECTED")
    );
    assert!(!reject.exists());
    assert_eq!(
        zip(&zip_path, &reject, (payload.len() - 1) as u64, || false),
        Err("INSTALL_ARCHIVE_REJECTED")
    );
    assert_eq!(
        zip(&zip_path, &reject, 1024, || true),
        Err("INSTALL_CANCELED")
    );
    assert!(!reject.exists());
    assert!(!fixture.path().join("escape").exists());
}
