# Unreal Engine 5 — live build setup

Same idea as the Roblox folder, different engine. I write source files and push;
your machine pulls them and the running editor picks them up while you watch.

The difference is that UE5 has **two** kinds of change, and they arrive
differently:

| What I change | How it reaches you | Your input |
|---|---|---|
| `Tools/build_level.py` — the level itself | editor re-runs the script | none |
| `Source/**.cpp` `.h` — gameplay code | UE Live Coding | one keypress |

So the loop is nearly hands-off, with one honest caveat: **compiled C++ needs
Ctrl+Alt+F11.** UE cannot hot-swap native code without being told to.

## Why the level is a Python script and not a .umap

A `.umap` is a binary blob. It cannot be diffed, cannot be merged, and I cannot
meaningfully edit it. `Tools/build_level.py` *is* the level, in text — spawn the
floor, the light, the pickups, the player start. Reviewable, versioned, and
re-runnable.

Same reason there are no Blueprints here. Blueprints are `.uasset`, also binary.
This project is **C++-first** so that everything I build is something you can
actually read in a diff.

## One-time setup

### 1. Install Unreal Engine 5
Epic Games Launcher → Unreal Engine → Library → **+** → install 5.4 or newer.
Budget **~100 GB** and a machine with a real GPU.

### 2. Install Visual Studio 2022
UE compiles C++ with MSVC, so this is not optional on Windows.
Installer → **Workloads** → tick:
- *Game development with C++*
- *Desktop development with C++*

Under *Individual components*, make sure **MSVC v143** and the
**Windows 10/11 SDK** are ticked. Epic's
[official setup page](https://dev.epicgames.com/documentation/en-us/unreal-engine/setting-up-visual-studio-development-environment-for-cplusplus-projects-in-unreal-engine)
lists the current exact set.

### 3. Generate project files and build

```powershell
git clone https://github.com/Djordje-tech/kockam.git
cd kockam\unreal
```

Right-click **`Kockam.uproject`** → *Generate Visual Studio project files*.
(First time it will ask which engine version — pick your installed 5.x.)

Then open `Kockam.sln` in Visual Studio, set configuration to
**Development Editor / Win64**, and press **Ctrl+Shift+B**.

First build takes 10–30 minutes. Every build after that is seconds.

### 4. Open the editor and build the level

Launch `Kockam.uproject`. Then in the editor:

1. **Window → Output Log**, and switch the dropdown at the bottom from `Cmd`
   to **`Python`**.
2. Type: `Tools/build_level.py` and hit enter.

A floor, a sky, and 24 spinning coins appear. Press **Play**, fly around with
WASD + mouse (space/ctrl for up and down), touch a coin — the counter in the
corner ticks up.

**That is the pipeline proven end to end.**

### 5. Arm the live loop

Two things, once per session:

```
# in the editor's Python console
Tools/autoreload.py
```

```powershell
# in a terminal, left running
.\watch.ps1
```

Now every push I make rebuilds your level within about five seconds. If the
push touched C++, `watch.ps1` tells you to hit **Ctrl+Alt+F11** and Live Coding
swaps the new code into the running editor without restarting it.

## What's in here

```
Kockam.uproject          project definition, Python plugin enabled
Config/                  engine, input and project settings (all text)
Source/
  Kockam.Target.cs       packaged game build rules
  KockamEditor.Target.cs editor build rules
  Kockam/
    Kockam.Build.cs      module dependencies
    KockamGameMode.*     wires up the pawn and player state
    KockamPlayerState.*  the currency, replicated, server-authoritative
    PickupActor.*        the collectable: overlap, pay, respawn
Tools/
  build_level.py         the level, as a script
  autoreload.py          editor-side file watcher
watch.ps1                git-side pull loop
```

The project is **asset-free on purpose.** It uses the engine's built-in flying
pawn and primitive shapes, so it compiles and plays with zero imported art. Art
is the thing you add once the game is decided, not before.

Two rules the code sticks to, same as the Roblox build:

- **The server owns the currency.** `AddCoins` returns early without
  `HasAuthority()`, and pickups only pay on the authority. A client can fake any
  overlap it likes and mint nothing.
- **Every tunable is a `UPROPERTY`.** Coin value, respawn delay, spin speed and
  pickup radius are all editable from the Details panel or from the build
  script, without a recompile.

## Before you commit to this path

UE5 gives you a far better engine than Roblox and **zero players**. Roblox hands
you tens of millions of people browsing for something to click; on UE5 you ship
to Steam or the Epic Games Store and every single player is one you paid for or
earned. The engine is not the bottleneck in a game business. Distribution is.

The money side, for reference:

- **Unreal royalty:** 5% of lifetime gross revenue above the first $1M. Below
  $1M you owe Epic nothing. Sales through the Epic Games Store are royalty-free.
- **Steam:** takes 30% (dropping at high volume).
- So a $10 game, 1,000 copies = $10,000 gross → about **$7,000** to you.

That is genuinely better per-unit than Roblox. It is also 1,000 strangers you
have to personally find, versus an algorithm that finds them for you.
