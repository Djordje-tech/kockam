"""
Makes the editor rebuild the level by itself whenever build_level.py changes
on disk.

Run this once per editor session:

    py Tools/autoreload.py

From then on the loop is hands-off: the git watcher pulls a new commit, the
file's timestamp changes, and the level rebuilds a second later while you are
looking at it. Run it again at any time to restart the watch — it cleans up
its previous callback first.

Everything happens inside the editor process, so there is no port to open and
no second tool to keep alive.
"""

import os
import time

import unreal

# Slate ticks every editor frame; only stat the file about once a second.
POLL_INTERVAL = 1.0

_HANDLE_ATTR = "_kockam_autoreload_handle"

_TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
_TARGET = os.path.join(_TOOLS_DIR, "build_level.py")

_state = {
    "last_mtime": None,
    "last_poll": 0.0,
}


def _run_target():
    with open(_TARGET, "r") as handle:
        source = handle.read()

    # Compiled with the real path so any traceback points at the actual file
    # and line rather than at "<string>".
    code = compile(source, _TARGET, "exec")
    exec(code, {"__name__": "__main__", "__file__": _TARGET})


def _tick(_delta_seconds):
    now = time.time()
    if now - _state["last_poll"] < POLL_INTERVAL:
        return
    _state["last_poll"] = now

    try:
        mtime = os.path.getmtime(_TARGET)
    except OSError:
        # Mid-pull the file can briefly not exist. Try again next poll.
        return

    if _state["last_mtime"] is None:
        _state["last_mtime"] = mtime
        return

    if mtime == _state["last_mtime"]:
        return

    _state["last_mtime"] = mtime
    unreal.log("[kockam] build_level.py changed, rebuilding")

    # A syntax error in a pushed script must not take the watcher down with
    # it — report it and stay armed for the fix.
    try:
        _run_target()
    except Exception as error:
        unreal.log_error("[kockam] rebuild failed: {}".format(error))


def start():
    # Stash the handle on the unreal module so a second run of this script can
    # find and cancel the first one. Module-level state would not survive,
    # since each `py` invocation gets a fresh namespace.
    existing = getattr(unreal, _HANDLE_ATTR, None)
    if existing is not None:
        unreal.unregister_slate_post_tick_callback(existing)
        unreal.log("[kockam] replaced previous autoreload watch")

    handle = unreal.register_slate_post_tick_callback(_tick)
    setattr(unreal, _HANDLE_ATTR, handle)

    unreal.log("[kockam] watching {}".format(_TARGET))


start()
