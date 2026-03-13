param(
  [string]$TargetDir = ".upstream/vscode",
  [string]$RepositoryUrl = "https://github.com/microsoft/vscode.git",
  [string]$Branch = "main",
  [switch]$StatusOnly
)

$ErrorActionPreference = "Stop"

function Write-Status {
  param([string]$Message)
  Write-Host "[codai-fork] $Message"
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$resolvedTarget = Join-Path $repoRoot $TargetDir
$targetParent = Split-Path $resolvedTarget -Parent

if (-not (Test-Path $targetParent)) {
  New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "git is required to bootstrap the VS Code OSS fork."
}

if (-not (Test-Path $resolvedTarget)) {
  if ($StatusOnly) {
    Write-Status "Fork source not bootstrapped yet. Expected path: $resolvedTarget"
    exit 0
  }

  Write-Status "Cloning $RepositoryUrl ($Branch) into $resolvedTarget"
  git clone --depth 1 --branch $Branch $RepositoryUrl $resolvedTarget
}

Push-Location $resolvedTarget

try {
  if (-not $StatusOnly) {
    Write-Status "Fetching latest upstream state for $Branch"
    git fetch origin $Branch --depth 1
  }

  $head = git rev-parse --short HEAD
  $currentBranch = git rev-parse --abbrev-ref HEAD
  $originUrl = git remote get-url origin
  $status = git status --short

  Write-Status "Path: $resolvedTarget"
  Write-Status "Origin: $originUrl"
  Write-Status "Branch: $currentBranch"
  Write-Status "HEAD: $head"

  if ([string]::IsNullOrWhiteSpace($status)) {
    Write-Status "Worktree: clean"
  } else {
    Write-Status "Worktree:"
    Write-Host $status
  }

  Write-Status "Next step: create a CodAI branch inside the upstream tree and start workbench/runtime patches there."
} finally {
  Pop-Location
}
