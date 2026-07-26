param(
  [int]$PollSeconds = 4
)

$taskRoot = Split-Path -Parent $PSScriptRoot
$jobsRoot = Join-Path $taskRoot 'reports\autosmt-jobs'
$pendingDir = Join-Path $jobsRoot 'pending'
$runningDir = Join-Path $jobsRoot 'running'
$completedDir = Join-Path $jobsRoot 'completed'
$failedDir = Join-Path $jobsRoot 'failed'
$lockPath = Join-Path $jobsRoot 'session-guard.lock'

foreach ($directory in @($pendingDir, $runningDir, $completedDir, $failedDir)) {
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
}
$mutexCreated = $false
$guardMutex = [System.Threading.Mutex]::new($false, 'Local\PigeonLib.AutoSMT.SessionGuard', [ref]$mutexCreated)
$mutexHeld = $false
try {
  try {
    $mutexHeld = $guardMutex.WaitOne(0)
  } catch [System.Threading.AbandonedMutexException] {
    $mutexHeld = $true
  }
} catch {
  $guardMutex.Dispose()
  throw
}
if (-not $mutexHeld) {
  $guardMutex.Dispose()
  Write-Host 'Another AutoSMT Session Guard appears to be running.'
  exit 1
}
if (Test-Path -LiteralPath $lockPath) {
  $activeLegacyGuard = $false
  try {
    $lockInfo = Get-Content -Raw -LiteralPath $lockPath | ConvertFrom-Json
    $existing = Get-Process -Id ([int]$lockInfo.pid) -ErrorAction Stop
    $expectedNames = @('powershell', 'pwsh')
    $lockStarted = [DateTimeOffset]::Parse([string]$lockInfo.startedAt)
    $processStarted = [DateTimeOffset]$existing.StartTime.ToUniversalTime()
    $activeLegacyGuard = (($expectedNames -contains $existing.ProcessName) -and
      ([Math]::Abs(($processStarted - $lockStarted).TotalSeconds) -le 5))
  } catch {
    $activeLegacyGuard = $false
  }
  if ($activeLegacyGuard) {
    $guardMutex.ReleaseMutex()
    $guardMutex.Dispose()
    Write-Host 'Another AutoSMT Session Guard appears to be running.'
    exit 1
  }
  Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}

$recovered = 0
Get-ChildItem -LiteralPath $runningDir -Filter '*.json' -File | Sort-Object Name | ForEach-Object {
  Move-Item -LiteralPath $_.FullName -Destination (Join-Path $pendingDir $_.Name) -ErrorAction Stop
  $recovered += 1
}
if ($recovered -gt 0) {
  Write-Host "Recovered $recovered interrupted job(s) to the pending queue."
}

$username = Read-Host 'AutoSMT username'
$securePassword = Read-Host 'AutoSMT password' -AsSecureString
$passwordPtr = [IntPtr]::Zero
$currentJob = $null

try {
  $passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  $env:AUTO_SMT_USERNAME = $username
  $env:AUTO_SMT_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr)
  $guardInfo = [ordered]@{
    pid = $PID
    processName = (Get-Process -Id $PID).ProcessName
    startedAt = (Get-Date).ToUniversalTime().ToString('o')
  }
  [System.IO.File]::WriteAllText($lockPath, ($guardInfo | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))

  Write-Host 'Checking the one-time login...'
  & node (Join-Path $PSScriptRoot 'autosmt-score-gate.mjs') score --checkpoint session-guard-login --timeout-ms 90000 --interval-ms 1800 --retries 8
  if ($LASTEXITCODE -ne 0) { throw "Login check failed with exit code $LASTEXITCODE." }

  Write-Host 'AutoSMT Session Guard is ready. Leave this window open.'
  Write-Host 'Tasks submitted by the AutoSMT launcher scripts will run one at a time.'
  while ($true) {
    $jobFile = Get-ChildItem -LiteralPath $pendingDir -Filter '*.json' -File | Sort-Object Name | Select-Object -First 1
    if ($null -eq $jobFile) {
      Start-Sleep -Seconds $PollSeconds
      continue
    }

    $currentJob = Join-Path $runningDir $jobFile.Name
    Move-Item -LiteralPath $jobFile.FullName -Destination $currentJob -ErrorAction Stop
    $job = Get-Content -Raw -LiteralPath $currentJob | ConvertFrom-Json
    if ($null -eq $job.args -or $job.args.Count -eq 0) { throw "Job $($job.id) has no command arguments." }

    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Running $($job.id): $($job.args -join ' ')"
    & node (Join-Path $PSScriptRoot 'autosmt-score-gate.mjs') @($job.args)
    $exitCode = $LASTEXITCODE
    $result = [ordered]@{
      id = $job.id
      createdAt = $job.createdAt
      completedAt = (Get-Date).ToUniversalTime().ToString('o')
      args = $job.args
      exitCode = $exitCode
    }
    $targetDir = if ($exitCode -eq 0) { $completedDir } else { $failedDir }
    $target = Join-Path $targetDir $jobFile.Name
    [System.IO.File]::WriteAllText($target, ($result | ConvertTo-Json -Depth 4), [System.Text.UTF8Encoding]::new($false))
    Remove-Item -LiteralPath $currentJob -Force
    $currentJob = $null
    if ($exitCode -eq 0) {
      Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Completed $($job.id)."
    } else {
      Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Failed $($job.id), checkpoint preserved. See $target"
    }
  }
} finally {
  if ($null -ne $currentJob -and (Test-Path -LiteralPath $currentJob)) {
    Move-Item -LiteralPath $currentJob -Destination (Join-Path $pendingDir (Split-Path -Leaf $currentJob)) -Force
  }
  Remove-Item Env:AUTO_SMT_USERNAME -ErrorAction SilentlyContinue
  Remove-Item Env:AUTO_SMT_PASSWORD -ErrorAction SilentlyContinue
  if ($passwordPtr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr)
  }
  Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
  if ($mutexHeld) {
    try { $guardMutex.ReleaseMutex() } catch { }
    $guardMutex.Dispose()
  }
}
