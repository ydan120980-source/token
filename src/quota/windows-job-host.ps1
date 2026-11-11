$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$PSModuleAutoLoadingPreference = 'None'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
    Import-Module ([System.IO.Path]::Combine($PSHOME, 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1'))
    $requestText = [Console]::In.ReadLine()
    if ($requestText.Length -gt 131072) { throw 'JOB_REQUEST_INVALID' }
    $request = $requestText | ConvertFrom-Json
    $source = [System.IO.Path]::Combine($PSScriptRoot, 'windows-job-host.cs')
    $assembly = $env:AGENTUSAGE_JOB_ASSEMBLY
    $loaded = $false
    if ($assembly) {
        # Compiled once per source. A failure here costs a compile below, never the read.
        try {
            if (-not [System.IO.File]::Exists($assembly)) {
                $temporary = $assembly + '.' + $PID + '.tmp'
                Add-Type -Path $source -OutputAssembly $temporary -OutputType Library
                try { [System.IO.File]::Move($temporary, $assembly) } catch { [System.IO.File]::Delete($temporary) }
            }
            Add-Type -Path $assembly
            $loaded = $true
        } catch { $loaded = $false }
    }
    if (-not $loaded) { Add-Type -Path $source }
    $result = [AgentUsage.WindowsJobHost]::Run([string]$request.executable, [string]$request.sha256, [string[]]$request.arguments, [string]$request.cwd, [string[]]$request.environment, [int]$request.parentPid, [int]$request.timeoutMs, [int]$request.maxOutputBytes, [bool]$request.interactive, [bool]$request.authBrowser)
    [Console]::Out.WriteLine(($result | ConvertTo-Json -Compress))
} catch {
    [Console]::Out.WriteLine('{"schemaVersion":"WindowsJobResultV1","errorCode":"JOB_HOST_UNAVAILABLE","reaped":false,"stdout":"","stderr":""}')
    exit 1
}
