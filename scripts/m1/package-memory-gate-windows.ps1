param(
    [Parameter(Mandatory)][string]$Executable,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [Parameter(Mandatory)][string]$MakeNsis
)

$ErrorActionPreference = 'Stop'
$source = (Get-Item -LiteralPath $Executable).FullName
$compiler = (Get-Item -LiteralPath $MakeNsis).FullName
$output = (New-Item -ItemType Directory -Path $OutputDirectory -Force).FullName
$tempRoot = (Get-Item -LiteralPath ([IO.Path]::GetTempPath())).FullName
$scratch = Join-Path $tempRoot ('quotadock-memory-package-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch | Out-Null

try {
    Copy-Item -LiteralPath $source -Destination (Join-Path $scratch 'quotadock-desktop.exe')
    @'
Unicode true
Name "QuotaDock Memory Gate"
OutFile "QuotaDock-Tauri-memory-gate-setup.exe"
InstallDir "$TEMP\QuotaDockMemoryGate"
RequestExecutionLevel user
SetCompressor /SOLID lzma
Section
  SetOutPath "$INSTDIR"
  File "quotadock-desktop.exe"
SectionEnd
'@ | Set-Content -LiteralPath (Join-Path $scratch 'memory-gate.nsi') -Encoding ascii

    Push-Location -LiteralPath $scratch
    try {
        & $compiler /V2 memory-gate.nsi
        if ($LASTEXITCODE -ne 0) { throw 'NSIS build failed.' }
    } finally { Pop-Location }

    $name = 'QuotaDock-Tauri-memory-gate-setup.exe'
    Copy-Item -LiteralPath (Join-Path $scratch $name) -Destination $output
    $setup = Get-Item -LiteralPath (Join-Path $output $name)
    [ordered]@{
        kind = 'nsis-diagnostic-payload'
        bytes = $setup.Length
        sha256 = (Get-FileHash -LiteralPath $setup.FullName).Hash.ToLowerInvariant()
        payloadSha256 = (Get-FileHash -LiteralPath $source).Hash.ToLowerInvariant()
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'tauri-setup.json')
} finally {
    $owned = (Get-Item -LiteralPath $scratch).FullName
    if ([IO.Path]::GetDirectoryName($owned) -eq $tempRoot -and
        [IO.Path]::GetFileName($owned) -like 'quotadock-memory-package-*') {
        Remove-Item -LiteralPath $owned -Recurse -Force
    }
}
