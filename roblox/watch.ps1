#Requires -Version 5.1
<#
.SYNOPSIS
    Live-sync loop for watching the game get built.

.DESCRIPTION
    Starts `rojo serve` (so Roblox Studio picks up file changes the instant they
    land on disk) and polls the remote branch for new commits. Every time new
    work is pushed, it fast-forwards your checkout and Studio updates itself a
    second later.

    Run this in a terminal, leave it running, and watch Studio.

.EXAMPLE
    .\watch.ps1
    .\watch.ps1 -IntervalSeconds 3
    .\watch.ps1 -NoServe        # you already have rojo serve running elsewhere
#>
[CmdletBinding()]
param(
    [string]$Branch = "claude/roblox-game-building-setup-486kk3",
    [int]$IntervalSeconds = 5,
    [switch]$NoServe
)

$ErrorActionPreference = "Stop"

$ProjectDir = $PSScriptRoot
$RepoRoot = (git -C $ProjectDir rev-parse --show-toplevel).Trim()

function Write-Status($Message, $Color = "Gray") {
    Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message) -ForegroundColor $Color
}

$current = (git -C $RepoRoot rev-parse --abbrev-ref HEAD).Trim()
if ($current -ne $Branch) {
    Write-Status "You are on '$current' but watching '$Branch'. Switching." Yellow
    git -C $RepoRoot checkout $Branch
}

$rojo = $null
if (-not $NoServe) {
    if (-not (Get-Command rojo -ErrorAction SilentlyContinue)) {
        throw "rojo is not on your PATH. See roblox/README.md, step 2."
    }

    Write-Status "Starting rojo serve on http://localhost:34872" Cyan
    $rojo = Start-Process -FilePath "rojo" `
        -ArgumentList "serve", "default.project.json" `
        -WorkingDirectory $ProjectDir `
        -PassThru -NoNewWindow
}

Write-Status "Watching '$Branch' every ${IntervalSeconds}s. Ctrl+C to stop." Cyan

try {
    while ($true) {
        # A failed fetch is almost always a blip in the connection, so it warns
        # and retries on the next tick rather than killing the loop.
        try {
            git -C $RepoRoot fetch --quiet origin $Branch
        } catch {
            Write-Status "fetch failed, retrying next tick" DarkYellow
            Start-Sleep -Seconds $IntervalSeconds
            continue
        }

        $local = (git -C $RepoRoot rev-parse HEAD).Trim()
        $remote = (git -C $RepoRoot rev-parse FETCH_HEAD).Trim()

        if ($local -ne $remote) {
            $subject = (git -C $RepoRoot log -1 --pretty=%s $remote).Trim()
            Write-Status "New commit: $subject" Green

            # --ff-only so a local edit is never silently thrown away.
            git -C $RepoRoot merge --ff-only FETCH_HEAD
            if ($LASTEXITCODE -ne 0) {
                Write-Status "Cannot fast-forward - you have local commits or edits here." Red
                Write-Status "Stash or commit them, then this loop resumes on its own." Red
            }
        }

        Start-Sleep -Seconds $IntervalSeconds
    }
} finally {
    if ($rojo -and -not $rojo.HasExited) {
        Write-Status "Stopping rojo serve" Cyan
        $rojo | Stop-Process -Force
    }
}
