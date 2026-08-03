$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$python = Join-Path $repo ".venv\Scripts\python.exe"
$probeScript = Join-Path $PSScriptRoot "probe-erp.py"
$probeResult = Join-Path $PSScriptRoot "erp-probe.json"
$probeTaskName = "EETT ERP Probe"
$logPath = Join-Path $PSScriptRoot "restart-eett-admin.log"

Start-Transcript -Path $logPath -Append
try {
    Stop-ScheduledTask -TaskName "EETT" -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
    Start-ScheduledTask -TaskName "EETT"
    Start-Sleep -Seconds 5

    $serviceTask = Get-ScheduledTask -TaskName "EETT"
    if ($serviceTask.State -ne "Running") {
        throw "EETT did not enter the Running state after restart"
    }

    Remove-Item -LiteralPath $probeResult -Force -ErrorAction SilentlyContinue
    $action = New-ScheduledTaskAction -Execute $python -Argument "`"$probeScript`""
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
    Register-ScheduledTask `
        -TaskName $probeTaskName `
        -Action $action `
        -Principal $principal `
        -Settings $settings `
        -Description "One-shot EETT Softland connectivity probe" `
        -Force | Out-Null
    Start-ScheduledTask -TaskName $probeTaskName

    $deadline = (Get-Date).AddSeconds(45)
    do {
        Start-Sleep -Milliseconds 500
        $probeTask = Get-ScheduledTask -TaskName $probeTaskName
    } while ($probeTask.State -eq "Running" -and (Get-Date) -lt $deadline)

    $probeInfo = Get-ScheduledTaskInfo -TaskName $probeTaskName
    if (-not (Test-Path -LiteralPath $probeResult)) {
        throw "SYSTEM ERP probe did not produce a result; task result=$($probeInfo.LastTaskResult)"
    }
    $result = Get-Content -LiteralPath $probeResult -Raw | ConvertFrom-Json
    if (-not $result.ok) {
        throw "SYSTEM ERP probe failed: $($result.error_type): $($result.message)"
    }
    Write-Output "SYSTEM ERP probe succeeded; cost centers=$($result.cost_center_count)"
} finally {
    Unregister-ScheduledTask -TaskName $probeTaskName -Confirm:$false -ErrorAction SilentlyContinue
    Stop-Transcript
}
