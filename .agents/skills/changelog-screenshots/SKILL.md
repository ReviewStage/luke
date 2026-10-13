---
name: changelog-screenshots
description: Take the CHANGELOG.md screenshots for a Luke release, or redo an older release's, from that release's own build on the developer's Mac with mock data staged for each picture. Plans one intentional shot per feature section that needs one, writes a throwaway staging patch (fixture profiles, canned answers, layout), builds and captures on the Mac, frames each shot or a close-up of it on the Golden Gate wallpaper, and lands the pictures. Use when asked for changelog or release screenshots, or to improve an old release's.
---

# Changelog screenshots

The rules every picture follows are in the comment atop `CHANGELOG.md`; this
is how to meet them. A release's pictures come from its own build: the commit
that bumped `apps/desktop/package.json` to that version (`git log -S'"version":
"<v>"' -- apps/desktop/package.json`), or `main` before the bump lands. The
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
  elsewhere open another plan, another tab, or fold it away.

Show the developer the list (and the old releases' pictures it should not
repeat) before staging; it is cheap to change now and expensive later.

## 2. Stage them

Fixture mode (`--fixture smoke`) signs in to nothing, answers every service
read "unanswered", and stages only a few `--profile`s (`RUN_PROFILE` in
`apps/desktop/src/shared/messages/app-state.ts`). Everything a picture needs
beyond that is a throwaway patch, never committed, applied on the Mac to the
release commit. `staging/0.12.0.patch` beside this file is 0.12.0's, applied
to `6d47d20f`: start from it. Its `apps/desktop/src/renderer/shots/README.md`
explains the design, which is, in short:

- One `--profile shot-<name>` per picture, each a `ShotSpec` in its own file
  under `renderer/shots/`, so agents can fill shots in parallel without
  touching each other's files.
- One seam answers the acts: `renderer/act.ts`'s door asks the shot's canned
  answers first, and each answer still passes its kind's own result check. A
  read the app re-asks as soon as it lands (an agent's transcript, the Inbox)
  gets its page once and then a promise that never settles, or it spins.
- One staging effect lays the window out once its pieces are drawn: the
  sidebar fold, the side panel's tab, width, and full screen, the plan
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
  believable plans, agents, diffs, and dialogue about one feature
  ("Teammate invitations"). Model ids from the repository's real catalog.
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
leaves grey traffic lights. A batch of ten takes about two minutes after a
three-minute build.

## 4. Frame, review, and land

Frame with the repository's own script, from the synced checkout:

```sh
bash $S/scripts/changelog-screenshot.sh out/the-call-tab.png --from ~/luke-shots/<v>/call.png
bash $S/scripts/changelog-screenshot.sh out/skills.png --from ~/luke-shots/<v>/skills.png --crop 30,230,860,830
```

A crop is `x,y,width,height` in window points from the window's top-left
corner; go negative or past the window, up to 90 points, to take in
wallpaper. It is cut from the framed picture and scaled to the whole
picture's height (1591 pixels), so it can be no wider than about 1.5 times its
height, and at under about 800 points tall it is enlarged past the capture's
pixels: keep it above about 600 so text stays sharp. Find the numbers from a
preview of the raw capture, which is 2 pixels a point on a Retina display, its
window body starting 112 by 76 pixels in from the shadow. A close-up that
shows empty space is a staging problem as often as a cropping one: 0.12.0's
skill picker needed more transcript above it, not a tighter crop.

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
