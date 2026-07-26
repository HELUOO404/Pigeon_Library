param(
  [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)]
  [string[]]$AutoSmtArgs
)

$taskRoot = Split-Path -Parent $PSScriptRoot
$queueDir = Join-Path $taskRoot 'reports\autosmt-jobs\pending'
New-Item -ItemType Directory -Force -Path $queueDir | Out-Null

$safeCommand = ($AutoSmtArgs[0] -replace '[^A-Za-z0-9_-]', '-')
$job = [ordered]@{
  id = "$(Get-Date -Format 'yyyyMMdd-HHmmss-fff')-$safeCommand"
  createdAt = (Get-Date).ToUniversalTime().ToString('o')
  args = $AutoSmtArgs
}
$destination = Join-Path $queueDir "$($job.id).json"
[System.IO.File]::WriteAllText($destination, ($job | ConvertTo-Json -Depth 4), [System.Text.UTF8Encoding]::new($false))
Write-Host "Queued: $($job.id)"
