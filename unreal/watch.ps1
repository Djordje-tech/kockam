#Requires -Version 5.1
<#
.SYNOPSIS
    Pulls new commits so the Unreal editor picks them up while you watch.

.DESCRIPTION
    Polls the branch and fast-forwards your checkout whenever new work lands.
    What happens next depends on what changed:

      Tools/build_level.py  ->  rebuilt automatically, if you ran
                                `py Tools/autoreload.py` in the editor
      Source/**.cpp / .h    ->  Live Coding picks it up; press Ctrl+Alt+F11

    Leave this running in its own window for the whole session.

.EXAMPLE
    .\watch.ps1
    .\watch.ps1 -IntervalSeconds 3
#>
[CmdletBinding()]
param(
    [string]$Branch = "claude/roblox-game-building-setup-486kk3",
    [int]$IntervalSeconds = 5
)

$ErrorActionPreference = "Stop"

$RepoRoot = (git -C $PSScriptRoot rev-parse --show-toplevel).Trim()

function Write-Status($Message, $Color = "Gray") {
    Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message) -ForegroundColor $Color
}

$current = (git -C $RepoRoot rev-parse --abbrev-ref HEAD).Trim()
if ($current -ne $Branch) {
    Write-Status "You are on '$current' but watching '$Branch'. Switching." Yellow
    git -C $RepoRoot checkout $Branch
}

Write-Status "Watching '$Branch' every ${IntervalSeconds}s. Ctrl+C to stop." Cyan

while ($true) {
    # A failed fetch is almost always a blip in the connection, so it warns and
    # retries on the next tick rather than killing the loop.
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
        $changed = git -C $RepoRoot diff --name-only "$local" "$remote"

        Write-Status "New commit: $subject" Green

        # --ff-only so a local edit is never silently thrown away.
        git -C $RepoRoot merge --ff-only FETCH_HEAD
        if ($LASTEXITCODE -ne 0) {
            Write-Status "Cannot fast-forward - you have local commits or edits here." Red
            Write-Status "Stash or commit them, then this loop resumes on its own." Red
        }
        elseif ($changed -match '^unreal/Source/.*\.(cpp|h)$') {
            Write-Status "C++ changed - press Ctrl+Alt+F11 in the editor to hot-reload." Yellow
        }
    }

    Start-Sleep -Seconds $IntervalSeconds
}
