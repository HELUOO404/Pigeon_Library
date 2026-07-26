param(
  [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)]
  [string[]]$AutoSmtArgs
)

$username = Read-Host 'AutoSMT username'
$securePassword = Read-Host 'AutoSMT password' -AsSecureString
$passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)

try {
  $env:AUTO_SMT_USERNAME = $username
  $env:AUTO_SMT_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr)
  & node (Join-Path $PSScriptRoot 'autosmt-score-gate.mjs') @AutoSmtArgs
  exit $LASTEXITCODE
} finally {
  Remove-Item Env:AUTO_SMT_USERNAME -ErrorAction SilentlyContinue
  Remove-Item Env:AUTO_SMT_PASSWORD -ErrorAction SilentlyContinue
  if ($passwordPtr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr)
  }
}
