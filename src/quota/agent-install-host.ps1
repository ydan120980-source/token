param([string]$Mode, [string]$InputFile)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$PSModuleAutoLoadingPreference = 'None'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Import-Module ([IO.Path]::Combine($PSHOME, 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1'))
$request = [IO.File]::ReadAllText($InputFile) | ConvertFrom-Json
if ($Mode -eq 'expand') {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    # Windows PowerShell's .NET Framework otherwise hits MAX_PATH on the
    # official Node/npm tree even when the application itself supports it.
    $base = [IO.Path]::GetFullPath($request.destination)
    $source = [IO.Path]::GetFullPath($request.source)
    if ($base -notmatch '^[A-Za-z]:\\' -or $source -notmatch '^[A-Za-z]:\\') { throw 'INSTALL_ARCHIVE_REJECTED' }
    $base = $base.TrimEnd('\') + '\'
    $destination = '\\?\' + $base
    $source = '\\?\' + $source
    [IO.Directory]::CreateDirectory($destination) | Out-Null
    $zip = [IO.Compression.ZipFile]::OpenRead($source)
    try {
        $bytes = [long]0
        if ($zip.Entries.Count -gt 50000) { throw 'INSTALL_ARCHIVE_LIMIT' }
        foreach ($entry in $zip.Entries) {
            $target = [IO.Path]::GetFullPath([IO.Path]::Combine($base, $entry.FullName.Replace('/', '\')))
            $bytes += $entry.Length
            if (!$target.StartsWith($base, [StringComparison]::OrdinalIgnoreCase) -or $entry.FullName.Contains(':') -or $bytes -gt 2147483648 -or (($entry.ExternalAttributes -shr 16) -band 61440) -eq 40960) { throw 'INSTALL_ARCHIVE_REJECTED' }
            $target = '\\?\' + $target
            if ([String]::IsNullOrEmpty($entry.Name)) { [IO.Directory]::CreateDirectory($target) | Out-Null; continue }
            [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $false)
        }
    } finally { $zip.Dispose() }
    [Console]::Out.WriteLine('{"expanded":true}')
} elseif ($Mode -eq 'signature') {
    Import-Module ([IO.Path]::Combine($PSHOME, 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1'))
    $signature = Get-AuthenticodeSignature -LiteralPath $request.file
    $subject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { '' }
    $valid = $signature.Status -eq 'Valid' -and $subject -match $request.publisher
    [Console]::Out.WriteLine((@{ valid = [bool]$valid; version = [Diagnostics.FileVersionInfo]::GetVersionInfo($request.file).ProductVersion } | ConvertTo-Json -Compress))
} elseif ($Mode -eq 'metadata') {
    $files = [Collections.Generic.List[string]]::new()
    foreach ($file in $request.files) { $files.Add([string]$file) }
    if ($request.executable -match '^(Cursor|WorkBuddy|ZCode)\.exe$') {
        foreach ($prefix in @('HKEY_CURRENT_USER','HKEY_LOCAL_MACHINE')) {
            try {
                $key = [Microsoft.Win32.Registry]::GetValue("$prefix\Software\Microsoft\Windows\CurrentVersion\App Paths\$($request.executable)", '', $null)
                if ($key) { $files.Add([string]$key) }
            } catch {}
        }
    }
    $rows = @()
    foreach ($file in $files | Select-Object -Unique) {
        try {
            if ($file -notmatch '^[A-Za-z]:[\\/]' -or $file.Substring(2).Contains(':')) { continue }
            $current = [IO.Path]::GetFullPath($file)
            $aliased = $false
            while ($current) {
                if (([IO.File]::Exists($current) -or [IO.Directory]::Exists($current)) -and ([IO.File]::GetAttributes($current) -band [IO.FileAttributes]::ReparsePoint)) { $aliased = $true; break }
                $current = [IO.Path]::GetDirectoryName($current)
            }
            if ($aliased) { continue }
            if (![IO.File]::Exists($file)) { continue }
            $info = [Diagnostics.FileVersionInfo]::GetVersionInfo($file)
            $rows += @{ path = $file; version = $info.ProductVersion }
        } catch {}
    }
    [Console]::Out.WriteLine((@{ entries = @($rows) } | ConvertTo-Json -Depth 4 -Compress))
} else { throw 'INSTALL_HOST_MODE_REJECTED' }
