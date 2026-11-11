'use strict';
// Metadata only. Never reads clipboard contents, window titles or credentials.
const {execFileSync}=require('node:child_process');
function desktopReadiness(){
 if(process.platform!=='win32')return {checked:false,eligible:false,reason:'WINDOWS_DESKTOP_REQUIRED'};
 const script=`$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Stop'; Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; public static class DesktopReadiness { [DllImport("user32.dll",SetLastError=true)] public static extern bool OpenClipboard(IntPtr h); [DllImport("user32.dll")] public static extern bool CloseClipboard(); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p); }
'@; $opened=[DesktopReadiness]::OpenClipboard([IntPtr]::Zero); $failure=[Runtime.InteropServices.Marshal]::GetLastWin32Error(); if($opened){[void][DesktopReadiness]::CloseClipboard()}; [uint32]$foregroundId=0; [void][DesktopReadiness]::GetWindowThreadProcessId([DesktopReadiness]::GetForegroundWindow(),[ref]$foregroundId); $name=if($foregroundId){(Get-Process -Id $foregroundId -ErrorAction SilentlyContinue).ProcessName}else{'none'}; [pscustomobject]@{checked=$true;clipboardAvailable=$opened;clipboardError=if($opened){0}else{$failure};locked=($name -eq 'LockApp');eligible=($opened -and $name -ne 'LockApp')} | ConvertTo-Json -Compress`;
 try{return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:15000}));}
 catch{return {checked:false,eligible:false,reason:'DESKTOP_PROBE_FAILED'};}
}
module.exports={desktopReadiness};
