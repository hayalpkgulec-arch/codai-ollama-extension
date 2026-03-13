param(
  [string]$ForkDir = "..\codai-vscode-oss",
  [switch]$WithWatch,
  [switch]$SkipPrelaunch
)

$ErrorActionPreference = "Stop"

function Write-Status {
  param([string]$Message)
  Write-Host "[codai-fork] $Message"
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$legacyForkRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot ".upstream\vscode"))
$forkRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $ForkDir))
$nodeRoot = Join-Path $repoRoot ".tools\node-v22.22.0-win-x64"
$vsPath = "C:\Program Files\Microsoft Visual Studio\2022\Community"

if ($forkRoot -ne $legacyForkRoot -and -not (Test-Path $forkRoot) -and (Test-Path $legacyForkRoot)) {
  $legacyProcesses = Get-Process -Name "Code - OSS" -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and $_.Path.StartsWith($legacyForkRoot, [System.StringComparison]::OrdinalIgnoreCase)
  }

  if ($legacyProcesses) {
    Write-Status "Stopping legacy fork process(es) before migrating the checkout"
    $legacyProcesses | Stop-Process -Force
  }

  $forkParent = Split-Path $forkRoot -Parent
  if (-not (Test-Path $forkParent)) {
    New-Item -ItemType Directory -Path $forkParent -Force | Out-Null
  }

  Write-Status "Migrating legacy nested checkout from $legacyForkRoot to $forkRoot"
  Move-Item -Path $legacyForkRoot -Destination $forkRoot
}

if (-not (Test-Path $forkRoot)) {
  throw "Fork checkout not found at $forkRoot. Run 'npm run ide:fork:bootstrap' first."
}

if (-not (Test-Path $nodeRoot)) {
  throw "Portable Node 22 not found at $nodeRoot. Complete the local fork bootstrap first."
}

if (-not (Test-Path $vsPath)) {
  throw "Expected Visual Studio compatibility path not found at $vsPath."
}

$envPrefix = @(
  "set vs2022_install=$vsPath",
  "set GYP_MSVS_OVERRIDE_PATH=$vsPath",
  "set GYP_MSVS_VERSION=2022",
  "set npm_config_msvs_version=2022",
  "set PATH=$nodeRoot;%PATH%"
)

if (-not $SkipPrelaunch) {
  $compileCommand = ($envPrefix + @(
      "cd /d `"$repoRoot`"",
      "`"$nodeRoot\npm.cmd`" run compile"
    )) -join " && "

  Write-Status "Building CodAI extension before launch"
  Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $compileCommand -WorkingDirectory $repoRoot -Wait -NoNewWindow
}

if ($WithWatch) {
  $watchCommand = ($envPrefix + @(
      "cd /d `"$forkRoot`"",
      "`"$nodeRoot\npm.cmd`" run watch"
    )) -join " && "

  Write-Status "Starting watch process"
  Start-Process -FilePath "cmd.exe" -ArgumentList "/k", $watchCommand -WorkingDirectory $forkRoot | Out-Null
}

$launchCommandParts = [System.Collections.Generic.List[string]]::new()
foreach ($item in $envPrefix) {
  $launchCommandParts.Add($item)
}
$launchCommandParts.Add("cd /d `"$forkRoot`"")

if ($SkipPrelaunch) {
  $launchCommandParts.Add("set VSCODE_SKIP_PRELAUNCH=1")
}

$launchCommandParts.Add("call `"$forkRoot\scripts\code.bat`" --extensionDevelopmentPath `"$repoRoot`" `"$repoRoot`"")
$launchCommand = $launchCommandParts -join " && "

Write-Status "Launching VS Code OSS fork"
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $launchCommand -WorkingDirectory $forkRoot | Out-Null
