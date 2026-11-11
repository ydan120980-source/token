param([string]$Executable, [string]$Script, [string]$Connection, [string]$Directory)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
    if ($Connection -notmatch '^[a-f0-9-]{36}$') { exit 1 }
    $taskInput = [Text.StringBuilder]::new()
    $taskBuffer = [char[]]::new(4096)
    while (($taskCount = [Console]::In.Read($taskBuffer, 0, $taskBuffer.Length)) -gt 0) {
        if ($taskInput.Length + $taskCount -gt 524288) { exit 1 }
        [void]$taskInput.Append($taskBuffer, 0, $taskCount)
    }
    # Electron is a GUI subsystem executable. Use explicit redirected process
    # handles and wait for exit instead of PowerShell's native command pipeline.
    function Quote-TaskArgument([string]$Value) {
        if ($Value -match '["\x00-\x1f]') { throw 'INVALID_ARGUMENT' }
        return '"' + ($Value -replace '(\\+)$', '$1$1') + '"'
    }
    $taskInfo = [Diagnostics.ProcessStartInfo]::new()
    $taskInfo.FileName = $Executable
    $taskInfo.Arguments = (Quote-TaskArgument $Script) + ' --connection ' + $Connection + ' --directory ' + (Quote-TaskArgument $Directory)
    $taskInfo.UseShellExecute = $false
    $taskInfo.CreateNoWindow = $true
    $taskInfo.RedirectStandardInput = $true
    $taskInfo.RedirectStandardOutput = $true
    $taskInfo.RedirectStandardError = $true
    $taskInfo.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
    $taskInfo.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)
    $taskInfo.EnvironmentVariables['ELECTRON_RUN_AS_NODE'] = '1'
    $taskProcess = [Diagnostics.Process]::new()
    $taskProcess.StartInfo = $taskInfo
    if (!$taskProcess.Start()) { exit 1 }
    $taskOut = $taskProcess.StandardOutput.ReadToEndAsync()
    $taskErr = $taskProcess.StandardError.ReadToEndAsync()
    $taskProcess.StandardInput.Write($taskInput.ToString())
    $taskProcess.StandardInput.Close()
    if (!$taskProcess.WaitForExit(10000)) { $taskProcess.Kill(); $taskProcess.WaitForExit(); exit 1 }
    $taskResult = $taskOut.GetAwaiter().GetResult()
    [void]$taskErr.GetAwaiter().GetResult()
    if ($taskProcess.ExitCode -ne 0 -or !$taskResult) { exit 1 }
    $taskProcess.Dispose()
    [Console]::Out.WriteLine($taskResult)
    exit 0
} catch { exit 1 }
finally {
    if ($taskProcess) {
        try { if (!$taskProcess.HasExited) { $taskProcess.Kill(); $taskProcess.WaitForExit() }; $taskProcess.Dispose() } catch { }
    }
}
