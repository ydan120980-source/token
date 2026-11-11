param([string]$OutputPath, [string]$Payload)
$ErrorActionPreference = 'Stop'
if ($Payload -notmatch '^[A-Za-z0-9+/=]+$') { throw 'INVALID_SYNTHETIC_PAYLOAD' }
$source = @"
using System;
using System.Text;
public static class SyntheticQuotaCli {
  public static int Main(string[] args) {
    Console.OutputEncoding = new UTF8Encoding(false);
    if (args.Length == 1 && args[0] == "--version") { Console.WriteLine("1.2.11"); return 0; }
    if (String.Join(" ", args) == "-p /usage --output-format json --print-timeout 20s") {
      Console.WriteLine(Encoding.UTF8.GetString(Convert.FromBase64String("$Payload"))); return 0;
    }
    return 2;
  }
}
"@
Add-Type -TypeDefinition $source -OutputAssembly $OutputPath -OutputType ConsoleApplication
