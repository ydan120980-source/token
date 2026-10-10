"""Package only reviewed source and the independent Windows quota directory.
Run with the host's bundled Python; no credentials or userData are inputs.

Delivery shape: each generation keeps the extracted `win-unpacked/` directory and
one source ZIP. The per-generation Windows ZIP is no longer produced by default,
because it duplicated the whole ~156 MB runtime next to the identical directory and
a ZIP cannot be hardlinked. `--windows-zip` restores the old packaging on demand.
`--refresh-records` rewrites only manifest/SHA256SUMS against artifacts already on
disk, so an existing generation can be re-described without rebuilding its zips.
"""
from pathlib import Path
import argparse
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--output-dir', default='dist')
parser.add_argument('--windows-dir', default='dist/win-unpacked')
parser.add_argument('--source-only', action='store_true')
parser.add_argument('--windows-zip', action='store_true',
                    help='also emit AgentUsage-CodexQuota-Windows-x64.zip (duplicates win-unpacked)')
parser.add_argument('--refresh-records', action='store_true',
                    help='rewrite manifest and SHA256SUMS from existing artifacts only')
parser.add_argument('--acceptance-doc', default='docs/m2/RESULTS-R10-20261010.md',
                    help='workspace document describing this generation acceptance')
options = parser.parse_args()
acceptance = (root / options.acceptance_doc).resolve()
assert acceptance.is_relative_to(root / 'docs') and acceptance.is_file()
output = (root / options.output_dir).resolve()
windows = (root / options.windows_dir).resolve()
assert output.is_relative_to(root / 'dist') and windows.is_relative_to(root / 'dist')
output.mkdir(parents=True, exist_ok=True)
assert options.source_only or (windows / "Agent Usage Quota.exe").is_file()

SOURCE_NAME = "AgentUsage-source.zip" if options.source_only else "AgentUsage-CodexQuota-source.zip"
MANIFEST_NAME = "AgentUsage-source-delivery.json" if options.source_only else "AgentUsage-CodexQuota-delivery.json"
SUMS_NAME = "SOURCE-SHA256SUMS.txt" if options.source_only else "SHA256SUMS.txt"
WINDOWS_ZIP_NAME = "AgentUsage-CodexQuota-Windows-x64.zip"


def archive(target, entries):
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as file:
        for source, name in entries:
            file.write(source, name)
    with zipfile.ZipFile(target) as file:
        assert file.testzip() is None
    return {"file": target.name, "bytes": target.stat().st_size,
            "sha256": hashlib.sha256(target.read_bytes()).hexdigest(), "files": len(entries)}


def describe_zip(target):
    with zipfile.ZipFile(target) as file:
        files = len([name for name in file.namelist() if not name.endswith("/")])
    return {"file": target.name, "bytes": target.stat().st_size,
            "sha256": hashlib.sha256(target.read_bytes()).hexdigest(), "files": files}


def describe_dir(directory):
    """Deterministic record of an extracted deliverable: per-file hash + tree hash."""
    entries = sorted(p for p in directory.rglob("*") if p.is_file())
    hasher = hashlib.sha256()
    total = 0
    for entry in entries:
        relative = entry.relative_to(directory).as_posix()
        size = entry.stat().st_size
        total += size
        hasher.update(f"{relative}\0{size}\0{hashlib.sha256(entry.read_bytes()).hexdigest()}\n".encode())
    return {"form": "directory", "file": directory.name,
            "files": len(entries), "bytes": total, "sha256": hasher.hexdigest()}


if options.refresh_records:
    source = describe_zip(output / SOURCE_NAME)
    binary = None if options.source_only else (
        describe_zip(output / WINDOWS_ZIP_NAME) if (output / WINDOWS_ZIP_NAME).is_file() else describe_dir(windows))
else:
    binary = None
    if not options.source_only:
        binary = archive(output / WINDOWS_ZIP_NAME,
                         [(p, p.relative_to(windows).as_posix()) for p in sorted(windows.rglob("*")) if p.is_file()]) \
            if options.windows_zip else describe_dir(windows)
    folders = ["src/m1", "src/quota", "scripts/m1", "tests/m1", "design/desktop-reference", "assets", "docs/m1", "docs/m2", "research/agent-usage", ".github"]
    # Paths kept on disk for local reference but deliberately outside the distributable archive.
    # Kept in sync with the "Working notes" section of .gitignore.
    excluded = [("docs", "m1", "history")]
    excluded_files = {
        "docs/m1/ACTIVITY-RANGE-FIX-20261004.md", "docs/m1/ACTIVITY-UI-20261004.md",
        "docs/m1/DETAIL-UI-20261004.md", "docs/m1/NOWDEX-UI-20261003.md",
        "docs/m1/UI-POLISH-20261004.md",
        "docs/m2/AGENT-INTEGRATION-PLAN-20261005.md",
        "docs/m2/AGENT-INTEGRATION-RESULTS-20261005.md",
        "docs/m2/AGENT-INTEGRATION-RESULTS-R3-20261006.md",
        "docs/m2/AGENT-INTEGRATION-RESULTS-R4-20261006.md",
        "docs/m2/AGENT-INTEGRATION-REVIEW-20261005.md",
        "docs/m2/AGENT-INTEGRATION-REVIEW-R2-20261006.md",
        "docs/m2/DESKTOP-REFINEMENT-20261004.md",
        "docs/m2/RESULTS-R8-20261008.md",
        "docs/m2/UI-REFINEMENT-RESULTS-R6-20261006.md",
    }
    source_entries = [(p, p.relative_to(root).as_posix()) for folder in folders
                      for p in sorted((root / folder).rglob("*")) if p.is_file()
                      and p.relative_to(root).as_posix() not in excluded_files
                      and not any(tuple(Path(p.relative_to(root)).parts[:len(prefix)]) == prefix for prefix in excluded)]
    source_entries += [(root / name, name) for name in
                       ["package.json", "package-lock.json", "eslint.config.js", ".gitignore", ".gitattributes",
                        "AGENTS.md", "CONTRIBUTING.md", "SECURITY.md", "NOTICE", "CHANGELOG.md", "LICENSE",
                        "README.md", "docs/PRIVACY.md", "docs/UPSTREAM-PROVENANCE.md", "docs/AGENT-HANDOFF.md"]]
    assert not any(part in {"node_modules", "artifacts", ".cache", ".git", "dist", "handoff", "upstream"}
                   for _, name in source_entries for part in Path(name).parts)
    assert not any(Path(name).name in {"auth.json", "quota-cache.json", "statistics.json", "runtime.json"}
                   for _, name in source_entries)
    source = archive(output / SOURCE_NAME, source_entries)
manifest = {"kind": "Unified Windows local usage and Codex quota build", "version": "0.1.0",
            "cliDependency": "official installed codex.exe; not bundled",
            "source": source, "windows": binary,
            "runtimeSharing": "Delivered as dist/<generation>/win-unpacked; identical runtime files are hardlinked across generations by scripts/m1/dist-share.js, so each generation keeps a complete logical directory while identical bytes are stored once.",
            "realAccountAcceptance": "This maintenance build was tested synthetically; previous real-account evidence is preserved separately. No real login/logout was performed during maintenance.",
            "syntheticAcceptance": "See " + acceptance.relative_to(root).as_posix() + " for this generation executed checks and workload limits; older reports describe historical builds.",
            "multiAccountAcceptance": "synthetic only",
            "unsigned": True, "scope": "Local offline usage within documented adapter contracts and Codex quota; no cloud/iOS/reset consumption/account switching"}
# LF records so standard `sha256sum -c` works on Windows checkouts too.
(output / MANIFEST_NAME).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf8", newline="\n")
(output / SUMS_NAME).write_text("".join(item["sha256"] + "  " + item["file"] + "\n" for item in [source, binary] if item), encoding="utf8", newline="\n")
print(json.dumps(manifest, ensure_ascii=False))
