# Each release's staging

The throwaway patch every release's pictures were taken with, applied to that
release's tag (`git apply` on a clean checkout of it), and how each picture was
captured and framed. A redo starts here: apply the patch, adjust what needs
adjusting, and capture with the same profile, zoom, and crop.
0.12.0's staging lives one level up, as `shots/` and `hooks-0.12.0.patch`; 0.13.0's patch is that module carried onto `v0.13.0`, with its hooks moved to where 0.13.0 keeps them.

| Release | Tag | Picture | Profile | Zoom | Crop (`x,y,width,height` points) |
| --- | --- | --- | --- | --- | --- |
| 0.1.0 | `v0.1.0` | `one-panel-for-every-agent.png` | `shot-one-panel` (`--expanded`) | 2 | `--layout top`, `380,-90,840,700` |
| 0.1.0 | `v0.1.0` | `talk-to-luke.png` | `shot-talk` (`--compact --peek`) | 2 | `--layout top`, `540,-90,520,347` |
| 0.1.1 | `v0.1.1` | `free-daily-allowance.png` | `shot-allowance` (`--expanded`) | 2 | `--layout top`, `500,-90,600,400` |
| 0.1.1 | `v0.1.1` | `google-calendar.png` | `shot-calendar` (`--expanded`) | 2 | `--layout top`, `500,-5,600,400` |
| 0.3.10 | `v0.3.10` | `onboarding.png` | `shot-onboarding` | 2 | `--layout bleed`, whole |
| 0.5.0 | `v0.5.0` | `onboarding-ends-at-a-calendar.png` | `shot-calendar-gate` (`--expanded`) | 2 | `--layout top`, `450,-90,700,467` |
| 0.6.0 | `v0.6.0` | `lukes-notebook.png` | `shot-notebook` (`--expanded`) | 2 | `--layout top`, `500,0,600,400` |
| 0.6.0 | `v0.6.0` | `the-conversation-tab.png` | `shot-conversation` (`--expanded`) | 2 | `--layout top`, `457,-90,686,540` |
| 0.7.0 | `v0.7.0` | `plan-a-feature-with-luke.png` | `shot-plan-a-feature` | 1 | whole window |
| 0.8.0 | `v0.8.0` | `a-new-home-for-your-plans.png` | `shot-home` | 1 | whole window |
| 0.8.0 | `v0.8.0` | `a-side-panel-for-the-board-the-code-and-the-transcript.png` | `shot-board` | 1 | whole window |
| 0.8.0 | `v0.8.0` | `luke-as-a-planning-teammate.png` | `shot-teammate` | 2 | `884,0,708,700` |
| 0.9.0 | `v0.9.0` | `a-work-tab.png` | `shot-work` | 2 | `966,2,624,500` |
| 0.10.0 | `v0.10.0` | `coding-agents.png` | `shot-coding-agents` | 1 | whole window |
| 0.10.0 | `v0.10.0` | `planning-on-a-github-repository.png` | `shot-github-repository` | 2 | `400,385,800,540` |
| 0.11.0 | `v0.11.0` | `coding-agents-work-alongside-you.png` | `shot-coding-agents` | 2 | `892,0,700,500` |
| 0.11.0 | `v0.11.0` | `subagents.png` | `shot-subagents` | 1 | whole window |
| 0.12.0 | `6d47d20f` | `the-call-tab.png`, `the-plan-is-one-document.png`, `version-history.png`, `the-inbox.png`, `the-changes-tab.png`, `pages.png` | `shot-call`, `shot-document`, `shot-history`, `shot-inbox`, `shot-changes`, `shot-pages` | 1 | whole window |
| 0.12.0 | `6d47d20f` | `a-command-palette.png` | `shot-palette` | 2 | `380,60,860,860` |
| 0.12.0 | `6d47d20f` | `skills.png` | `shot-skills` | 2 | `30,230,860,830` |
| 0.12.0 | `6d47d20f` | `integrations.png` | `shot-integrations` | 2 | `560,30,740,491` |
| 0.12.0 | `6d47d20f` | `pin-archive-and-group-plans.png` | `shot-plans` | 1 | `-70,-70,720,1140` |
| 0.13.0 | `v0.13.0` | `workspaces.png`, `home.png`, `the-inbox-one-item-at-a-time.png` | `shot-workspaces`, `shot-home`, `shot-inbox` | 1 | whole window |
| 0.13.0 | `v0.13.0` | `eight-more-integrations.png` | `shot-integrations` | 2 | `588,64,688,834` |
| 0.13.0 | `v0.13.0` | `the-mcp-popover.png` | `shot-mcp` | 2 | `370,346,800,654` |
| 0.14.0 | `2ec91a61` | `the-terminal-tab.png` | `shot-terminal` | 1 | whole window |
| 0.14.0 | `2ec91a61` | `workspaces-clearer.png` | `shot-switcher` | 1 | `-70,-70,660,1140` |
| 0.14.0 | `2ec91a61` | `who-did-what.png` | `shot-who` | 2 | `343,-40,860,850` |
| 0.14.0 | `2ec91a61` | `at-mentions.png` | `shot-mentions` | 2 | `522,330,820,710` |
| 0.15.0 | `v0.15.0` | `pictures-in-plans.png`, `pictures-from-coding-agents.png`, `a-persons-page.png` | `shot-plan-pictures`, `shot-agent-pictures`, `shot-person` | 1 | whole window |
| 0.15.0 | `v0.15.0` | `start-a-task-from-linear.png` | `shot-linear` | 1 | `-70,-70,780,1140` |
| 0.16.0 | `v0.16.0` | `links.png` | `shot-links` | 2 | `580,40,760,507` |
| 0.16.0 | `v0.16.0` | `agents-that-start-agents.png` | `shot-agents-start` | 2 | `395,350,750,500` |
| 0.16.0 | `v0.16.0` | `luke-at-any-width.png` | `shot-width` | 1 | `1060,-60,600,1120` |
| 0.17.0 | `v0.17.0` (`3489acc5`) | `pull-request-tab.png` | `shot-pull-request-tab` | 1 | `690,-60,970,1120` |
| 0.17.0 | `v0.17.0` (`3489acc5`) | `cards-on-every-chip.png` | `shot-chip-card` | 2 | `395,120,760,507` |
| 0.18.0 | `v0.18.0` (`ea04463d`) | `continue-and-fork-an-agent.png` | `shot-continue-fork` | 2 | `530,125,750,500` |
| 0.18.0 | `v0.18.0` (`ea04463d`) | `review-in-the-pull-request-tab.png`, `inbox-threads.png` | `shot-review`, `shot-inbox-threads` | 1 | whole window |
| 0.19.0 | `v0.19.0` (`f9ba4ff5`) | `pull-request-chapters.png`, `task-status-priority-and-the-board.png` | `shot-chapters`, `shot-board` | 1 | whole window |
| 0.19.0 | `v0.19.0` (`f9ba4ff5`) | `inbox-asks.png` | `shot-inbox-asks` | 2 | `592,54,750,760` |

0.14.0 was shot from `2ec91a61`, the head of its version pull request (#2871) before its pictures landed; `v0.14.0.patch` carries 0.13.0's module onto it, with 0.14.0's five shots beside the earlier ones.

0.15.0 was shot from its tag; `v0.15.0.patch` carries 0.14.0's module onto it, with `team-world.ts` (who created each task and started each agent), `inbox-world.ts` (0.13.0's Inbox items), and `relay-pictures.ts` (Relay mockups rendered with headless Chromium) shared by its shots. Its Factory picture was taken and then removed, since the Factory is experimental; no shot turns an experiment on.

0.16.0 renamed plans to tasks in the wire, the host's state, and the view; `v0.16.0.patch` carries the module with those names, and hooks `use-link-standing.ts` and `use-known-names.ts` so link chips read the shot's own workspaces.

0.17.0 was shot from its tag, which was moved after the version commit (`59e77c5f`) to `3489acc5`; `v0.17.0.patch` carries the module onto 0.17.0's `tasks/` paths (`TasksControl` aliased as `PlansControl`). Its chip card is held open by dispatching `pointerover` on the chip whenever the card is not drawn.

0.18.0 and 0.19.0 were shot from their tags, both moved after their version commits (to `ea04463d` and `f9ba4ff5`); a clone that fetched the tags before the move holds the old ones. 0.18.0 moved the renderer into `packages/panel/src/`, so `v0.18.0.patch` carries the module to `packages/panel/src/shots/` with only the shared world and that release's shots, plus `pr-214.ts` (#214 written out file by file) and `dom-steps.ts` (steps that act on what draws after the App's renders: the reply's actions held drawn and its Fork to new agent held under the pointer). 0.19.0 sends acts over an oRPC port and reads the app state in slices, so `v0.19.0.patch` answers acts in `act.ts`'s `portAct` (`canned-acts.ts`'s `cannedResult`, with no runtime guard left to check an answer) and stages the snapshot itself where the window adopts it (`shot-state.ts`), and hooks the Chapters tab's chosen chapter (`ShotSpec.chapter`). Luke in your browser and on your phone has no picture: the web app's phone layout is no macOS window, and a phone picture waits for one taken in an iOS Simulator on the Mac. Files changed, reworked has none either, since it read as 0.18.0's Files changed again.

Every shot can be checked before the Mac: on Linux, Electron runs under `xvfb-run -a` once `node node_modules/electron/install.js` has fetched it, launched as `electron . --disable-gpu --no-sandbox --disable-dev-shm-usage --fixture smoke --profile shot-<name>` (without `--disable-dev-shm-usage` a small `/dev/shm` fails the renderer's chunks with `ERR_FAILED`), and screenshotted with Playwright's `_electron`; only the fonts differ from the Mac's.

0.12.0 was shot from `6d47d20f`, the head of its version pull request (#2421), before the tag existed; `v0.12.0` itself is `0dec8cda`.

The notch-era releases (before 0.7.0) drew no ordinary window, so their
pictures are taken with the tag's own capture and framed with a layout: build
with `LUKE_SHOT_PATCH_DIST=0`, then from `apps/desktop` run
`electron . --user-data-dir=<tmp> --fixture smoke [--expanded] --profile <profile> --capture-evidence <out.png> --force-device-scale-factor=4`
and frame with `--layout top` or `bleed` and `--zoom 2`.
