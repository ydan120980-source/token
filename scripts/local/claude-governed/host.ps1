param([string]$Mode, [string]$InputFile)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$PSModuleAutoLoadingPreference = 'None'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Import-Module ([IO.Path]::Combine($PSHOME, 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1'))
$request = [IO.File]::ReadAllText($InputFile) | ConvertFrom-Json
if ($Mode -eq 'claude-governance' -or $Mode -eq 'claude-replace') {
    Import-Module ([IO.Path]::Combine($PSHOME, 'Modules/Microsoft.PowerShell.Management/Microsoft.PowerShell.Management.psd1'))
    Import-Module ([IO.Path]::Combine($PSHOME, 'Modules/NetSecurity/NetSecurity.psd1'))
    Import-Module ([IO.Path]::Combine($PSHOME, 'Modules/NetTCPIP/NetTCPIP.psd1'))
    $target = [IO.Path]::GetFullPath([IO.Path]::Combine($request.appData, 'npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe'))
    if ($target -notmatch '^[A-Za-z]:\\' -or $target.Substring(2).Contains(':')) { throw 'INSTALL_GOVERNANCE_REQUIRED' }
    $current = $target
    while ($current) {
        if (([IO.File]::Exists($current) -or [IO.Directory]::Exists($current)) -and ([IO.File]::GetAttributes($current) -band [IO.FileAttributes]::ReparsePoint)) { throw 'INSTALL_GOVERNANCE_REQUIRED' }
        $current = [IO.Path]::GetDirectoryName($current)
    }
    $rules = @(Get-NetFirewallRule -PolicyStore ActiveStore | Where-Object { $_.Group -eq 'ClaudeNetworkPolicy' })
    $present = $rules.Count -gt 0
    $covered = $false
    foreach ($rule in $rules) {
        if ($rule.Enabled -eq 'True' -and $rule.Action -eq 'Block' -and $rule.Direction -eq 'Outbound') {
            $application = $rule | Get-NetFirewallApplicationFilter
            $port = $rule | Get-NetFirewallPortFilter
            if ($application.Program -eq $target -and $port.Protocol -eq 'Any') { $covered = $true }
        }
    }
    $profiles = @(Get-NetFirewallProfile -PolicyStore ActiveStore)
    $profilesReady = $profiles.Count -eq 3 -and @($profiles | Where-Object { $_.Enabled -ne 'True' }).Count -eq 0
    $listeners = @(Get-NetTCPConnection -LocalPort 17898 -State Listen -ErrorAction SilentlyContinue)
    $present = $present -or $listeners.Count -gt 0
    $listenerReady = $listeners.Count -gt 0 -and @($listeners | Where-Object { $_.LocalAddress -ne '127.0.0.1' }).Count -eq 0
    foreach ($listener in $listeners) { if ((Get-Process -Id $listener.OwningProcess).ProcessName -ne 'verge-mihomo') { $listenerReady = $false } }
    $ready = $present -and $covered -and $profilesReady -and $listenerReady -and [IO.File]::Exists($target)
    if ($Mode -eq 'claude-governance') {
        $version = if ([IO.File]::Exists($target)) { [Diagnostics.FileVersionInfo]::GetVersionInfo($target).ProductVersion } else { $null }
        [Console]::Out.WriteLine((@{ present = $present; ready = [bool]$ready; covered = $covered; profilesReady = $profilesReady; listenerReady = $listenerReady; version = $version; target = $target } | ConvertTo-Json -Compress))
    } else {
        if (!$ready -or $request.target -ne $target -or [IO.Path]::GetDirectoryName($request.staged) -ne [IO.Path]::GetDirectoryName($target) -or [IO.Path]::GetFileName($request.staged) -notmatch '^claude\.exe\.agentusage-[a-f0-9-]+\.tmp$') { throw 'INSTALL_GOVERNANCE_REQUIRED' }
        if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $request.expectedOld -or (Get-FileHash -LiteralPath $request.staged -Algorithm SHA256).Hash.ToLowerInvariant() -ne $request.expectedNew) { throw 'INSTALL_TARGET_CHANGED' }
        Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ClaudeNativeReplace { [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool ReplaceFile(string target, string replacement, IntPtr backup, uint flags, IntPtr exclude, IntPtr reserved); }'
        if (![ClaudeNativeReplace]::ReplaceFile($target, $request.staged, [IntPtr]::Zero, 0, [IntPtr]::Zero, [IntPtr]::Zero)) { throw "INSTALL_REPLACE_FAILED $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
        [Console]::Out.WriteLine('{"replaced":true}')
    }
} else { throw 'INSTALL_HOST_MODE_REJECTED' }
