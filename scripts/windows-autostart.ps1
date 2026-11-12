# Opt-in only. Running without arguments just displays the current task.
[CmdletBinding()]
param([ValidateSet('Status', 'Enable', 'Disable', 'Run')][string]$Action = 'Status')
$ErrorActionPreference = 'Stop'
$taskName = 'BookFlip Local Server'
$projectRoot = Split-Path -Parent $PSScriptRoot
$serverPath = Join-Path $projectRoot 'local-app.mjs'

if ($Action -eq 'Run') {
    $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
    $port = if ($env:BOOKFLIP_LOCAL_PORT) { $env:BOOKFLIP_LOCAL_PORT } else { '4317' }
    try {
        $response = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$port/api/sources" -TimeoutSec 3
        if ($response.StatusCode -eq 200) { exit 0 }
    } catch {}
    $logRoot = Join-Path $env:LOCALAPPDATA 'BookFlip\logs'
    New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
    $process = Start-Process -FilePath $nodePath -ArgumentList @('"' + $serverPath + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot 'autostart.log') -RedirectStandardError (Join-Path $logRoot 'autostart-error.log') -Wait -PassThru
    exit $process.ExitCode
}

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($Action -eq 'Status') {
    if ($existing) { $existing | Select-Object TaskName, State, Actions, Triggers }
    else { Write-Output 'Autostart BookFlip jest wylaczony.' }
    exit 0
}
if ($Action -eq 'Disable') {
    if ($existing) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
    Write-Output 'Autostart wylaczony. Dzialajacy serwer nie zostal zatrzymany.'
    exit 0
}
if ($existing) { throw 'Zadanie juz istnieje. Najpierw sprawdz Status; aby zmienic lokalizacje, uzyj Disable i Enable.' }
if (!(Test-Path -LiteralPath $serverPath)) { throw 'Nie znaleziono local-app.mjs.' }
$null = Get-Command node.exe -ErrorAction Stop
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -Action Run'
$taskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings -Description 'Opcjonalny lokalny serwer BookFlip przy logowaniu wlasciciela.' | Out-Null
Write-Output 'Autostart wlaczony od nastepnego logowania. Zadanie nie zostalo teraz uruchomione.'
