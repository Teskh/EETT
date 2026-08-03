$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$caddyExe = "C:\caddy\caddy.exe"
$sourceCaddy = Join-Path $PSScriptRoot "Caddyfile"
$targetCaddy = "C:\caddy\Caddyfile"
$sourceIis = Join-Path $PSScriptRoot "web.config"
$targetIis = "C:\inetpub\wwwroot\web.config"
$caddyBackup = Join-Path $PSScriptRoot "Caddyfile.live-backup-$stamp"
$iisBackup = Join-Path $PSScriptRoot "web.config.live-backup-$stamp"
$logPath = Join-Path $PSScriptRoot "install-eett-admin.log"

Start-Transcript -Path $logPath -Append
try {
    & $caddyExe validate --config $sourceCaddy
    if ($LASTEXITCODE -ne 0) {
        throw "Candidate Caddy configuration did not validate"
    }

    Copy-Item -LiteralPath $targetCaddy -Destination $caddyBackup
    Copy-Item -LiteralPath $targetIis -Destination $iisBackup

    try {
        Copy-Item -LiteralPath $sourceCaddy -Destination $targetCaddy -Force
        Copy-Item -LiteralPath $sourceIis -Destination $targetIis -Force
        & $caddyExe validate --config $targetCaddy
        if ($LASTEXITCODE -ne 0) {
            throw "Installed Caddy configuration did not validate"
        }
        & $caddyExe reload --config $targetCaddy
        if ($LASTEXITCODE -ne 0) {
            throw "Caddy reload failed"
        }
    } catch {
        Copy-Item -LiteralPath $caddyBackup -Destination $targetCaddy -Force
        Copy-Item -LiteralPath $iisBackup -Destination $targetIis -Force
        & $caddyExe reload --config $targetCaddy
        throw
    }

    $action = New-ScheduledTaskAction `
        -Execute "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" `
        -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$PSScriptRoot\start-eett.ps1`""
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet `
        -MultipleInstances IgnoreNew `
        -RestartCount 5 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -StartWhenAvailable

    Register-ScheduledTask `
        -TaskName "EETT" `
        -Action $action `
        -Trigger $trigger `
        -Principal $principal `
        -Settings $settings `
        -Description "EETT FastAPI service on 127.0.0.1:5002" `
        -Force | Out-Null
    Start-ScheduledTask -TaskName "EETT"
    Start-Sleep -Seconds 5

    $task = Get-ScheduledTask -TaskName "EETT"
    $info = Get-ScheduledTaskInfo -TaskName "EETT"
    Write-Output "EETT task state=$($task.State) lastResult=$($info.LastTaskResult)"
    Write-Output "Caddy backup: $caddyBackup"
    Write-Output "IIS backup: $iisBackup"
} finally {
    Stop-Transcript
}
