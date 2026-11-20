param(
    [string]$TargetDir = $env:CARGO_TARGET_DIR,
    [string]$OutputDirectory,
    [string[]]$CargoArguments = @('--locked'),
    [switch]$ManualPreview,
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$target = 'x86_64-pc-windows-gnu'
$cli = '@tauri-apps/cli@2.12.6'
$privateKeyConfigured = -not [string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY)
$publicKeyConfigured = -not [string]::IsNullOrWhiteSpace($env:QUOTADOCK_UPDATER_PUBLIC_KEY)
$targetReady = $TargetDir -and [IO.Path]::IsPathRooted($TargetDir) -and (Test-Path -LiteralPath $TargetDir -PathType Container)
$status = [ordered]@{
    updateMode = if ($ManualPreview) { 'manual-preview' } else { 'signed-updater' }
    updaterPublicKeyConfigured = $publicKeyConfigured
    updaterSigningKeyConfigured = $privateKeyConfigured
    readyForSelectedMode = [bool]($targetReady -and ($ManualPreview -or ($privateKeyConfigured -and $publicKeyConfigured)))
    existingCargoTarget = [bool]$targetReady
    cliVersion = $cli
    target = $target
}
if ($CheckOnly) {
    $status | ConvertTo-Json
    return
}
if (!$ManualPreview -and (!$privateKeyConfigured -or !$publicKeyConfigured)) { throw 'UPDATER_SIGNING_NOT_CONFIGURED' }
if (!$targetReady) { throw 'RELEASE_TARGET_NOT_CONFIGURED' }
if (!$OutputDirectory) {
    $OutputDirectory = if ($ManualPreview) { 'artifacts/m6-manual-preview' } else { 'artifacts/m6-release' }
}

$targetRoot = (Resolve-Path -LiteralPath $TargetDir).Path
$drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($targetRoot))
$memory = (Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory
if ($drive.AvailableFreeSpace -lt 15GB -or $memory -lt 2000000) { throw 'RELEASE_BUILD_RESOURCES_LOW' }
if (Get-CimInstance Win32_Process -Filter "Name='cargo.exe' OR Name='rustc.exe' OR Name='makensis.exe'") {
    throw 'RELEASE_BUILD_ALREADY_RUNNING'
}

Push-Location -LiteralPath $repository
$overlayPath = $null
$originalPublicKey = $env:QUOTADOCK_UPDATER_PUBLIC_KEY
try {
    $base = Get-Content -LiteralPath 'src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json
    $overlay = Get-Content -LiteralPath 'src-tauri/tauri.release.conf.json' -Raw | ConvertFrom-Json -AsHashtable
    if ($ManualPreview) {
        $overlay.bundle.createUpdaterArtifacts = $false
        # update_host embeds this value at compile time.
        $env:QUOTADOCK_UPDATER_PUBLIC_KEY = $null
    } else {
        $overlay.plugins = @{ updater = @{ pubkey = $originalPublicKey.Trim(); requireSignedVersion = $true } }
    }
    $output = (New-Item -ItemType Directory -Path $OutputDirectory -Force).FullName
    $overlayPath = Join-Path $output ('overlay-' + [Guid]::NewGuid().ToString('N') + '.json')
    $overlay | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $overlayPath -Encoding utf8NoBOM
    $env:CARGO_TARGET_DIR = $targetRoot
    $env:CARGO_BUILD_JOBS = '1'

    & node scripts/m1/stage-tauri-reader.js
    if ($LASTEXITCODE) { throw 'RELEASE_RENDERER_FAILED' }
    $started = [DateTime]::UtcNow
    & npx.cmd --yes --package $cli -- tauri build --ci --bundles nsis --target $target --config $overlayPath -- @CargoArguments
    if ($LASTEXITCODE) { throw 'RELEASE_NSIS_BUILD_FAILED' }
    $bundle = Join-Path $targetRoot "$target/release/bundle/nsis"
    $packages = @(Get-ChildItem -LiteralPath $bundle -Filter '*-setup.exe' -File |
        Where-Object { $_.LastWriteTimeUtc -ge $started })
    if ($packages.Count -ne 1) { throw 'RELEASE_NSIS_ARTIFACT_AMBIGUOUS' }
    $installer = $packages[0]
    if (!$ManualPreview) {
        $signature = Get-Item -LiteralPath ($installer.FullName + '.sig')
        if ($signature.Length -eq 0) { throw 'RELEASE_SIGNATURE_MISSING' }
    }
    # Recorded from the Electron v0.1.8 installer during the memory gate.
    # The installer and local receipt may have been pruned from this checkout.
    $receipt = [ordered]@{
        version = $base.version
        identifier = $base.identifier
        installer = $installer.Name
        updateMode = $status.updateMode
        bytes = $installer.Length
        sha256 = (Get-FileHash -LiteralPath $installer.FullName).Hash.ToLowerInvariant()
        electronBytes = 127434956
        electronSha256 = '372751706f89d6b275629241003c8d9ad93147bc01e95a009165923e4ea11a86'
        sizeGate = $installer.Length -le 15MB
    }
    $receipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'nsis-receipt.json') -Encoding utf8NoBOM
    if (!$receipt.sizeGate) { throw 'RELEASE_NSIS_SIZE_GATE_FAILED' }
    $delivery = Join-Path $output $installer.Name
    if ((Test-Path -LiteralPath $delivery) -or (Test-Path -LiteralPath ($delivery + '.sig'))) { throw 'RELEASE_DESTINATION_EXISTS' }
    Move-Item -LiteralPath $installer.FullName -Destination $delivery
    if (!$ManualPreview) {
        Move-Item -LiteralPath $signature.FullName -Destination ($delivery + '.sig')
    }
    $receipt | ConvertTo-Json
} finally {
    $env:QUOTADOCK_UPDATER_PUBLIC_KEY = $originalPublicKey
    if ($overlayPath -and (Test-Path -LiteralPath $overlayPath -PathType Leaf)) {
        Remove-Item -LiteralPath $overlayPath -ErrorAction Stop
    }
    Pop-Location
}
