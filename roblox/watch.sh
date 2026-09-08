#!/usr/bin/env bash
# Live-sync loop for watching the game get built (macOS / Linux).
# Starts `rojo serve` and fast-forwards the branch whenever new work is pushed,
# so Roblox Studio updates itself while you watch.
#
#   ./watch.sh                  # serve + poll every 5s
#   INTERVAL=3 ./watch.sh       # poll faster
#   NO_SERVE=1 ./watch.sh       # rojo serve is already running elsewhere

set -euo pipefail

BRANCH="${BRANCH:-claude/roblox-game-building-setup-486kk3}"
INTERVAL="${INTERVAL:-5}"

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(git -C "$project_dir" rev-parse --show-toplevel)"

status() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$1"; }

current="$(git -C "$repo_root" rev-parse --abbrev-ref HEAD)"
if [ "$current" != "$BRANCH" ]; then
	status "On '$current' but watching '$BRANCH'. Switching."
	git -C "$repo_root" checkout "$BRANCH"
fi

rojo_pid=""
if [ -z "${NO_SERVE:-}" ]; then
	command -v rojo >/dev/null || { echo "rojo is not on your PATH. See roblox/README.md, step 2." >&2; exit 1; }

	status "Starting rojo serve on http://localhost:34872"
	(cd "$project_dir" && rojo serve default.project.json) &
	rojo_pid=$!
	trap 'if [ -n "$rojo_pid" ]; then kill "$rojo_pid" 2>/dev/null || true; fi' EXIT
fi

status "Watching '$BRANCH' every ${INTERVAL}s. Ctrl+C to stop."

while true; do
	# A failed fetch is almost always a connection blip: warn and try again on
	# the next tick rather than killing the loop.
	if ! git -C "$repo_root" fetch --quiet origin "$BRANCH" 2>/dev/null; then
		status "fetch failed, retrying next tick"
		sleep "$INTERVAL"
		continue
	fi

	local_sha="$(git -C "$repo_root" rev-parse HEAD)"
	remote_sha="$(git -C "$repo_root" rev-parse FETCH_HEAD)"

	if [ "$local_sha" != "$remote_sha" ]; then
		status "New commit: $(git -C "$repo_root" log -1 --pretty=%s "$remote_sha")"

		# --ff-only so a local edit is never silently thrown away.
		if ! git -C "$repo_root" merge --ff-only FETCH_HEAD; then
			status "Cannot fast-forward - you have local commits or edits here."
			status "Stash or commit them, then this loop resumes on its own."
		fi
	fi

	sleep "$INTERVAL"
done
