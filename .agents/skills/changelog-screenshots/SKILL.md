---
name: changelog-screenshots
description: Take the CHANGELOG.md screenshots for a Luke release, or redo an older release's, from that release's own build on the developer's Mac with mock data staged for each picture. Plans one intentional shot per feature section that needs one, writes a throwaway staging patch (fixture profiles, canned answers, layout), builds and captures on the Mac, frames each shot or a close-up of it on the Golden Gate wallpaper, and lands the pictures. Use when asked for changelog or release screenshots, or to improve an old release's.
---

# Changelog screenshots

The rules every picture follows are in the comment atop `CHANGELOG.md`; this
is how to meet them. A release's pictures come from its own build: the commit
the release's tag (`v<version>`, what shipped), or for a release not yet
tagged, the head of its version pull request. The
work is in four parts: plan the shots, stage them in a throwaway patch, build
and capture on the Mac, then frame and land them.

You need the developer's Mac (Conductor's `RunLocalCommand`): the native build,
the window capture, and the framer are macOS-only. The cloud workspace writes
code and reviews pictures; with Conductor's file sync on, anything under the
workspace's `.context/` appears on the Mac at
`~/conductor/remote-workspace-sync/luke/<workspace-id>/.context/`, and nothing
syncs back.

## 1. Plan the shots

Read the release's `CHANGELOG.md` entry and write a shot list in
`.context/shots/SPEC.md` before any code: for each `###` section, whether it
gets a picture, what the picture must show, and the composition that puts that
in front. Then look at the list as a set.

- A section gets a picture only where one helps. Plumbing (a shared runtime, a
  fix) gets none; a single row or button is a close-up, not a whole window.
- No two pictures share a composition. The 0.8.0–0.11.0 pictures fail this:
  seven of them are the same plan document on the left with the feature
  squeezed into a panel on the right. Vary the layout per shot: the sidebar
  folded or open, the side panel closed, wide, or full screen, a full-window
  view (Settings, version history), a menu, card, or palette held open.
- Vary the framing: the whole window (1600 by 1000 points) where the layout is
  the point, a `--crop` close-up where the feature is one part of it. A
  close-up is the framed picture zoomed in, never a cut-out: the feature stays
  inside the app around it (the ⌘K palette over its dimmed plan, the sidebar
  with the window's corner and wallpaper beyond), and it comes out exactly as
  tall as a whole-window picture, only narrower. The changelog page shows
  every picture at that one height.
- The plan document is not wallpaper. Show it only where it is the subject;
  elsewhere open another task, another tab, or fold it away.
- Nothing experimental gets a picture. A feature behind Settings ›
  Experimental (the Factory, Issues, Code review, video calls, and whatever
  joins them) is no section's subject, even where the notes announce it, and
  no shot turns an experiment on (`ShotSpec.experiments` stays empty), so
  nothing an experiment draws (a sidebar row, the Code review suggestion)
  shows at the edge of another picture either. 0.15.0's Factory and
  0.17.0's Issues pictures were taken and then removed for this.

Show the developer the list (and the old releases' pictures it should not
repeat) before staging; it is cheap to change now and expensive later.

## 2. Stage them

Fixture mode (`--fixture smoke`) signs in to nothing, answers every service
read "unanswered", and stages only a few `--profile`s (`RUN_PROFILE` in
`packages/host/src/app-state.ts`). Everything a picture needs
beyond that is a throwaway patch, never committed, applied on the Mac to the
release commit. Start from 0.12.0's, beside this file:

- `WORLD.md` is the invented company every release's pictures happen in: its
  name and mark, repositories, the task everything is about, its coding agents
  and pull requests, people, and how times are told. Reuse it, so the pictures
  stay one continuing story; add new tasks and work for what a release shows,
  and record what is worth keeping there.
- `assets/` holds acme's mark (`acme-mark.svg`) and Dean's photo
  (`dean-stratakos.jpg`), the two images every picture carries.
- `staging/shots/` is 0.12.0's `apps/desktop/src/renderer/shots/` module:
  the shared world as data, one file per shot, and the machinery. Copy it into
  the release's checkout and adapt it to that release's types.
- `staging/releases/` holds every earlier release's staging patch and a table
  of each picture's profile, zoom, and crop, so any picture can be taken again
  exactly; redoing an old release starts from its patch there.
- `staging/hooks-0.12.0.patch` is the small set of hooks that module needs in
  0.12.0's app files; it will not apply to another release as it stands, but
  it says where each hook goes. Together on `6d47d20f` the two reproduce
  0.12.0's staging exactly.

Hand the Mac one patch: in a cloud worktree of the release commit, copy
`staging/shots/` in, make the hooks, `git add -N .`, and `git diff` to
`.context/shots/staging.patch`. The module's own `README.md` explains its
design, which is, in short:

- One `--profile shot-<name>` per picture, each a `ShotSpec` in its own file
  under `renderer/shots/`, so agents can fill shots in parallel without
  touching each other's files.
- One seam answers the acts: `renderer/act.ts`'s door asks the shot's canned
  answers first, and each answer still passes its kind's own result check. A
  read the app re-asks as soon as it lands (an agent's transcript, the Inbox)
  gets its page once and then a promise that never settles, or it spins.
- One staging effect lays the window out once its pieces are drawn: the
  sidebar fold, the side panel's tab, width, and full screen, the task
  column's tab, Settings' page, version history, ⌘K with a query typed, a
  hover card held open.
- Hooks into app files are few and marked `Throwaway:`.

Every picture, whatever it shows:

- Signed in as Dean Stratakos with his GitHub photo in the account row, the
  photo embedded as a data URL (`https://avatars.githubusercontent.com/u/29683763`).
- No Update pill, no "Voice is off: sign in" bar, no other development or
  signed-out chrome; no call bar unless the shot is about the call.
- Times counted back from launch (`now - 4 minutes`), because the fixture's
  own timestamps draw "Dec 31, 1969" and "Working… 146h". A running turn
  started seconds before launch reads "Working… 20s".
- Synthetic data on the acme organisation: its repositories (`acme/relay`,
  `acme/ledger`, `acme/web`), its teal two-peak mark as the owner picture,
  believable tasks, agents, diffs, and dialogue about one feature
  ("Teammate invitations"). Model ids from the repository's real catalog.
- Positive states: everything connected, checks passing, work done or
  moving. An error, an empty list, a disconnected service, or a "Connect"
  button goes in only when that state is what the section announces. The
  staging may answer a status the release would not (0.12.0's Slack, not
  available yet, shows connected) so a picture reads as a feature working;
  what it may not do is draw a row or control the release does not have.
- No experiment switched on: the window as a user who never opened Settings ›
  Experimental sees it.
- Real UI only. Stage data and state the app already draws; never add a row,
  label, or control the release does not have (0.12.0's first Integrations
  shot invented a GitHub row and was rejected). Something the release shows
  that the notes leave out, such as Slack's "Not available" row, stays.
- An interactive page or mockup inside the app (a Page tab) takes a palette
  of its own, light where the app is dark, so it reads as content, not
  chrome.

Each shot's agent verifies in the cloud before anything reaches the Mac:
`pnpm typecheck`, `pnpm build` (esbuild only; `build:native` needs macOS;
`LUKE_UPDATE_BUNDLE_BUDGET=1` if the embedded pictures trip the budget), and a
throwaway jsdom render of the shot that checks its key text and the absence of
"1969", deleted before the diff. Merge the shots by copying each agent's
`shots/` files into one worktree over the foundation, not by stacking patches:
an untracked `shots/` folder makes `git diff` patches overlap.

## 3. Build and capture on the Mac

The helpers in `scripts/` run on the Mac from the synced copy of this skill,
through `bash`, since file sync drops the executable bit.
`SHOTS_WORKTREE` (default `~/Developer/luke-changelog-shots`) is a throwaway
worktree of the clone at `LUKE_REPO` (default `~/Developer/luke`); nothing
touches the developer's own checkout or a running Luke.

```sh
S=~/conductor/remote-workspace-sync/luke/<workspace-id>
bash $S/.agents/skills/changelog-screenshots/scripts/build.sh <commit> $S/.context/shots/staging.patch
bash $S/.agents/skills/changelog-screenshots/scripts/window.sh ~/luke-shots/<v>/call.png --profile shot-call
```

`build.sh` checks the release out, applies the patch, installs, builds, and
patches the built main bundle (`patch-dist.sh`) so state lives under the run's
own `--user-data-dir` and the window opens at 1600 by 1000 points and focused.
`window.sh` launches the build in fixture mode, captures the real window with
its shadow and traffic lights, and quits it. It retries until the window was
key; tell the developer before a batch, because typing elsewhere during it
leaves grey traffic lights. It parks the pointer on the menu bar first, since
a window as large as the screen otherwise draws a hover wherever the pointer
rests. macOS refuses every window capture ("could not create image from
window") while the screen is locked: check
`ioreg -n Root -d1 -a | grep -A1 CGSSessionScreenIsLocked`, ask the
developer to unlock, and keep the display awake with `caffeinate -d -i -t 3600`
for the batch. The first launch after a build may still be downloading
Electron's binary, so capture again if that one fails. A batch of ten takes about two minutes after a
three-minute build.

### The notch era (before 0.7.0)

Before 0.7.0 Luke drew no ordinary window: a borderless panel hung from the
notch at a high window level, and onboarding was a full-display overlay, so
`window.sh` finds nothing to capture. Build with `LUKE_SHOT_PATCH_DIST=0` (the
window patches would pull the panel off the top edge), have the staging raise
the tag's capture settle to about 3 s, isolate its state on `--user-data-dir`
where the tag overrides it (v0.3.9–v0.5.0), and pick the window it captures,
then capture with the tag's own flag at 4 pixels a point:

```sh
electron . --user-data-dir=<tmp> --fixture smoke --expanded --profile shot-<name> \
  --capture-evidence <out.png> --force-device-scale-factor=4
```

Frame it with a layout: `--layout top` hangs the panel flush from the top of
the standard canvas, centred, as it hung from the notch, and takes a crop
counted from where a standard window's corner would be (the panel's top is at
y = -90); `--layout bleed` lays a full-display overlay across the wallpaper.
Both take `--zoom 2` for the 4x capture.

## 4. Frame, review, and land

Frame with the repository's own script, from the synced checkout:

```sh
bash $S/scripts/changelog-screenshot.sh out/the-call-tab.png --from ~/luke-shots/<v>/call.png
LUKE_SHOT_ZOOM=2 bash $S/.agents/skills/changelog-screenshots/scripts/window.sh ~/luke-shots/<v>/skills.png --profile shot-skills
bash $S/scripts/changelog-screenshot.sh out/skills.png --from ~/luke-shots/<v>/skills.png --crop 30,230,860,830 --zoom 2
```

Capture a close-up zoomed, so it is sharp: `LUKE_SHOT_ZOOM=2 window.sh …`
opens the window twice as large in points (past the screen, which
`patch-dist.sh` allows) with its page zoomed to match, so the layout is the
same 1600 by 1000 points drawn at 4 pixels a point; frame it with `--zoom 2`
and the same crop. macOS's own chrome does not zoom, so the traffic lights,
corners, and shadow come out half size: take a close-up that shows the
window's edge (the sidebar's corner) unzoomed, and make it tall enough not to
need the pixels.

A crop is `x,y,width,height` in window points from the window's top-left
corner; go negative or past the window, up to 90 points, to take in wallpaper.
It is cut from the framed picture and scaled to the whole picture's height
(1591 pixels), so it can be no wider than about 1.5 times its height.
Unzoomed, a crop under about 800 points tall is enlarged past the capture's
pixels and goes soft; at `--zoom 2` that floor is about 400. Find the numbers
from a preview of the raw capture, which is 2 pixels a point on a Retina
display, its window body starting 112 by 76 pixels in from the shadow. A
close-up that shows empty space is a staging problem as often as a cropping
one: 0.12.0's skill picker needed more transcript above it, not a tighter
crop.

Review every picture in the cloud before showing anyone: make small JPEG
previews on the Mac (`sips -s format jpeg -Z 1500`), `tar` and `base64` them
to stdout, and decode the retained output here (`RunLocalCommand` keeps
output over 32,000 characters in `.context/conductor/`; keep each transfer
under about 10 MB). Read each one against the spec and the rules above, fix
the staging, rebuild, and capture again; it took 0.12.0 four rounds.

Land the finished PNGs in `apps/web/public/changelog/<version>/`, named for
the section, each under its section's pull request links in `CHANGELOG.md`
with alt text that says what the picture shows. `./scripts/check.sh` checks
every image path exists.
