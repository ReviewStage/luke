# Each release's staging

The throwaway patch every release's pictures were taken with, applied to that
release's tag (`git apply` on a clean checkout of it), and how each picture was
captured and framed. A redo starts here: apply the patch, adjust what needs
adjusting, and capture with the same profile, zoom, and crop.
0.12.0's staging lives one level up, as `shots/` and `hooks-0.12.0.patch`.

| Release | Tag | Picture | Profile | Zoom | Crop (`x,y,width,height` points) |
| --- | --- | --- | --- | --- | --- |
| 0.1.0 | `v0.1.0` | `one-panel-for-every-agent.png` | `shot-one-panel` (`--expanded`) | 2 | `--layout top`, `380,-90,840,700` |
| 0.3.10 | `v0.3.10` | `onboarding.png` | `shot-onboarding` | 2 | `--layout bleed`, whole |
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

0.12.0 was shot from `6d47d20f`, the head of its version pull request (#2421), before the tag existed; `v0.12.0` itself is `0dec8cda`.

The notch-era releases (before 0.7.0) drew no ordinary window, so their
pictures are taken with the tag's own capture and framed with a layout: build
with `LUKE_SHOT_PATCH_DIST=0`, then from `apps/desktop` run
`electron . --user-data-dir=<tmp> --fixture smoke [--expanded] --profile <profile> --capture-evidence <out.png> --force-device-scale-factor=4`
and frame with `--layout top` or `bleed` and `--zoom 2`.
