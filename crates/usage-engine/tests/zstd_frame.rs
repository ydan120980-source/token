use usage_engine::zstd_frame::frame_end;

// Real frame produced by the Node reference runtime (zlib.zstdCompressSync).
const FRAME: [u8; 32] = [
    0x28, 0xb5, 0x2f, 0xfd, 0x20, 0x17, 0xb9, 0x00, 0x00, 0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x7a,
    0x73, 0x74, 0x64, 0x20, 0x66, 0x72, 0x61, 0x6d, 0x65, 0x20, 0x70, 0x61, 0x72, 0x69, 0x74, 0x79,
];

#[test]
fn real_frame_boundaries() {
    assert_eq!(frame_end(&FRAME, 0), Ok(Some(32)));
    let two = [FRAME, FRAME].concat();
    assert_eq!(frame_end(&two, 0), Ok(Some(32)));
    assert_eq!(frame_end(&two, 32), Ok(Some(64)));
    assert_eq!(frame_end(&FRAME, 32), Ok(None));
}

#[test]
fn partial_magic_is_incomplete_not_invalid() {
    assert_eq!(frame_end(&FRAME[..1], 0), Ok(None));
    assert_eq!(frame_end(&FRAME[..3], 0), Ok(None));
    assert_eq!(frame_end(&[0x28, 0xb5, 0x00], 0), Err("SOURCE_COMPRESSION_INVALID"));
    assert_eq!(frame_end(&[0x00, 0x00, 0x00, 0x00], 0), Err("SOURCE_COMPRESSION_INVALID"));
}

#[test]
fn truncated_frame_is_incomplete() {
    assert_eq!(frame_end(&FRAME[..4], 0), Ok(None));
    assert_eq!(frame_end(&FRAME[..5], 0), Ok(None));
    assert_eq!(frame_end(&FRAME[..10], 0), Ok(None));
}

#[test]
fn skippable_frames() {
    let mut bytes = vec![0x50, 0x2a, 0x4d, 0x18];
    bytes.extend_from_slice(&7u32.to_le_bytes());
    bytes.extend_from_slice(&[0u8; 7]);
    assert_eq!(frame_end(&bytes, 0), Ok(Some(15)));
    let mut over = bytes.clone();
    over[4..8].copy_from_slice(&100u32.to_le_bytes());
    assert_eq!(frame_end(&over, 0), Ok(None));
    assert_eq!(frame_end(&bytes[..6], 0), Ok(None));
    let mut chained = bytes.clone();
    chained.extend_from_slice(&FRAME);
    assert_eq!(frame_end(&chained, 0), Ok(Some(15)));
    assert_eq!(frame_end(&chained, 15), Ok(Some(47)));
}

#[test]
fn reserved_descriptor_bit_rejected() {
    let mut bytes = FRAME;
    bytes[4] |= 8;
    assert_eq!(frame_end(&bytes, 0), Err("SOURCE_COMPRESSION_INVALID"));
}

#[test]
fn checksum_flag_extends_boundary() {
    let payload = b"checksum parity payload";
    let mut compressor = zstd::bulk::Compressor::new(3).unwrap();
    compressor
        .set_parameter(zstd::zstd_safe::CParameter::ChecksumFlag(true))
        .unwrap();
    let with = compressor.compress(payload).unwrap();
    let plain = zstd::stream::encode_all(&payload[..], 3).unwrap();
    let end_with = frame_end(&with, 0).unwrap().unwrap();
    let end_plain = frame_end(&plain, 0).unwrap().unwrap();
    assert_eq!(end_with, with.len());
    assert_eq!(end_plain, plain.len());
    assert_eq!(end_with, end_plain + 4);
}

#[test]
fn reserved_block_type_rejected() {
    // magic + descriptor(single-segment, no checksum, no dict, 1-byte content size)
    // then a block header with type 3 (reserved).
    let bytes = [0x28, 0xb5, 0x2f, 0xfd, 0x20, 0x01, 0x07, 0x00, 0x00];
    // header 0x000007: last=1, type=(7>>1)&3=3 -> reserved
    assert_eq!(frame_end(&bytes, 0), Err("SOURCE_COMPRESSION_INVALID"));
}