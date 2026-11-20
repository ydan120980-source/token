param([string]$OutputPath, [string]$Payload, [switch]$SyntheticLogin)
$ErrorActionPreference = 'Stop'
if ($Payload -notmatch '^[A-Za-z0-9+/=]+$') { throw 'INVALID_SYNTHETIC_PAYLOAD' }
$loginMode = if ($SyntheticLogin) { 'true' } else { 'false' }
$source = @"
using System;
using System.Text;
using System.IO;
public static class SyntheticQuotaCli {
  public static int Main(string[] args) {
    Console.OutputEncoding = new UTF8Encoding(false);
    if (args.Length == 1 && args[0] == "--version") { Console.WriteLine("1.2.11"); return 0; }
    string file = null;
    bool useLoginFixture = $loginMode;
    if (useLoginFixture) {
      var home = Environment.GetEnvironmentVariable("HOME");
      if (home != Environment.CurrentDirectory ||
          Environment.GetEnvironmentVariable("SSH_TTY") != "agentusage-scoped" ||
          Environment.GetEnvironmentVariable("AGY_CLI_DISABLE_AUTO_UPDATE") != "true") return 3;
      file = Path.Combine(home, ".gemini", "antigravity-cli", "antigravity-oauth-token");
      if (args.Length == 0) {
        Directory.CreateDirectory(Path.GetDirectoryName(file));
        File.WriteAllText(file, "{\"token\":{\"access_token\":\"synthetic-agy-login-1\"}}");
        return 0;
      }
    }
    if (String.Join(" ", args) == "-p /usage --output-format json --print-timeout 20s") {
      if (file != null) {
        var token = File.ReadAllText(file);
        if (!token.Contains("synthetic-agy-login-1") && !token.Contains("synthetic-agy-login-2")) return 4;
        File.WriteAllText(file, token.Replace("synthetic-agy-login-1", "synthetic-agy-login-2"));
      }
      Console.WriteLine(Encoding.UTF8.GetString(Convert.FromBase64String("$Payload"))); return 0;
    }
    return 2;
  }
}
"@
Add-Type -TypeDefinition $source -OutputAssembly $OutputPath -OutputType ConsoleApplication
