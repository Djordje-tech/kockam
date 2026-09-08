# Roblox game — live build setup

This folder is a Roblox place kept entirely as source files. I edit the files
here and push; your machine pulls them and pipes them straight into Roblox
Studio, live. You watch the game change in front of you and playtest it
whenever you like.

The piece that makes it live is **Rojo** — a tool that serves this folder to a
Studio plugin over localhost. Save a file, Studio updates. No manual importing,
no copy-pasting scripts.

```
me (cloud)  --push-->  GitHub  --pull-->  your PC  --rojo-->  Roblox Studio
                                             ^                      |
                                             +----- watch loop ------+
```

## One-time setup (about 10 minutes)

### 0. Install Git

You need Git to pull my pushes. Check whether you already have it:

```powershell
git --version
```

If that errors, install it from <https://git-scm.com/downloads>, accept every
default, then open a **new** terminal and check again.

### 1. Install Roblox Studio
<https://create.roblox.com/> → Download Studio. Sign in with your Roblox
account.

### 2. Install Rojo (the CLI)

Simplest route — grab the binary:

1. Open <https://github.com/rojo-rbx/rojo/releases> and download the latest
   `rojo-*-windows-x86_64.zip` (or the macOS build).
2. Unzip it and put `rojo.exe` somewhere on your PATH — e.g. create
   `C:\Tools`, drop it in, then add `C:\Tools` to PATH under
   *Settings → System → About → Advanced system settings → Environment
   Variables*.
3. Open a **new** terminal and check:

```powershell
rojo --version
```

Prefer a version manager? `rokit.toml` in this folder already pins the exact
versions this project expects. Install **Rokit** from
<https://github.com/rojo-rbx/rokit/releases>, run `rokit self-install` once,
then `rokit install` inside this folder and both `rojo` and `stylua` land on
your PATH at the pinned versions.

### 3. Install the Rojo Studio plugin

In Studio: **Toolbox → Plugins → search "Rojo"** (by Rojo), install it. Or from
the CLI: `rojo plugin install`.

### 4. Clone the repo and start the watcher

```powershell
git clone https://github.com/Djordje-tech/kockam.git
cd kockam
git checkout claude/roblox-game-building-setup-486kk3
cd roblox
.\watch.ps1
```

That `git checkout` matters: `git clone` leaves you on the repository's default
branch, and this project lives on a feature branch. Skip it and the `roblox`
folder does not exist yet.

`watch.ps1` does two jobs at once: it runs `rojo serve`, and every 5 seconds it
checks GitHub for new commits and fast-forwards your checkout. Leave it running
in its own terminal window for the whole session.

On macOS or Linux the equivalent is `./watch.sh`.

### 5. Connect Studio

1. In Studio: **File → New → Baseplate** (a fresh place with ground in it).
2. Open the **Rojo** plugin tab → **Connect** → it finds `localhost:34872`.
3. Everything under `src/` appears in the Explorer. Press **Play**.

You should see a coin counter at the top, an upgrades panel bottom-left, and
gold coins scattered across the baseplate. Walk into one — the counter ticks up.

**That's the pipeline working.** From then on, every time I push, your Studio
updates within about five seconds, live, while it's open.

### 6. Turn on saving (optional, do it once)

Progress only persists if DataStores are enabled:
**Game Settings → Security → Enable Studio Access to API Services → Save.**
Without it the game runs fine, you just start at 0 coins each session.

## When something doesn't work

The four ways this actually breaks, and the fix for each.

**`.\watch.ps1` says "running scripts is disabled on this system"**
Windows blocks unsigned scripts by default. Either allow them for your user
once:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

or skip the policy for this one run without changing any setting:

```powershell
powershell -ExecutionPolicy Bypass -File .\watch.ps1
```

**`rojo` or `git` "is not recognized"**
The tool isn't on your PATH, or the terminal predates the install. Close the
terminal, open a new one, and try again. Still failing means the PATH entry
didn't take — recheck step 0 or step 2.

**The Rojo plugin says it can't connect**
`rojo serve` isn't running. It lives in the `watch.ps1` window — if that window
has closed or shows an error, restart it. The plugin connects to
`localhost:34872`.

**Studio connects but the Explorer is empty**
You connected before the server was ready, or you're in a place where Rojo
already synced and then disconnected. Hit **Disconnect** then **Connect** again
in the Rojo panel.

## Publishing it

**File → Publish to Roblox As…**, fill in a name, done — it's live and
playable at a real URL. After the first publish, `File → Publish to Roblox`
(no dialog) pushes updates in one click.

Only publish when you want to; nothing here touches your Roblox account on its
own. I have no access to Studio or to your account — I only write files.

## What's in here

```
default.project.json    how files map onto Roblox instances
rokit.toml              pinned tool versions
watch.ps1 / watch.sh    the live-sync loop you leave running
src/
  shared/               code both sides need
    Config.luau         every tunable number in the game
    Net.luau            RemoteEvent plumbing
    Upgrades.luau       cost curve + upgrade effects
  server/               authoritative game logic
    init.server.luau    entry point
    DataService.luau    saving, loading, leaderstats
    CoinService.luau    spawns coins, pays players
    ShopService.luau    validates upgrade purchases
    PassService.luau    game pass ownership
  client/               UI and local effects only
    init.client.luau    entry point
    HUD.luau            coin counter, shop panel, popups
    Theme.luau          colours and fonts in one place
    CoinSpin.luau       local coin rotation
```

Two rules the code sticks to, because they are what separates a game that
survives contact with real players from one that doesn't:

- **The server decides everything that touches money.** The client sends "I
  want to buy the multiplier"; the server checks the balance and the price. An
  exploiter can fake any message they like and still not mint a coin.
- **Balance lives in `Config.luau`.** Changing how the game feels is a
  number-tuning pass, never a code rewrite.

## What this starter is

A working core loop — collect, spend, upgrade, repeat — with saving, a shop,
and monetisation hooks already wired in. It is deliberately generic: it's the
skeleton, and the actual game gets built on top of it once you tell me what
you want.

To make it a real game we swap the theme and the verb: coins become whatever
you're collecting, the baseplate becomes a real map, and the upgrade panel
becomes your progression. Say the word and I'll build it.
