# Automations, pickers, one-off agents: the build plan

Dean approved the show (items 1–24, every recommendation, decisions 1–17)
with one change, recorded under chain F. This branch,
`conductor/automations-batch-prototype`, is the **prototype** each chain
builds from. It's main with #2780 merged in, plus throwaway commits that
draw each change. **Read it for intent and placement, never copy it as-is.**
Its shortcuts are listed per chain under "Not production". Each chain
branches from `main`, not from this branch.

The show's harness is in `automations-batch/show/`. `scenes.tsx` mounts the
real renderer over a scripted bridge, and `build.mjs` and `shoot.mjs` draw
before and after, light and dark (usage is in each file's header).

## The approved decisions

1. Item 1 keeps the "Sharing" title over the Owner row.
2. Sharing comes first. #2781's Start from card follows it on a new automation.
3. The Automations list's Owner column uses the same pictures as the picker.
4. Escape asks with the leave dialog.
5. New task's pickers use the bordered Settings picker chip.
6. A one-off agent's sidebar row leads with its harness mark.
7. ⌘F matches page text, not typed field values. Settings keeps ⌘F on its own search.
8. A task agent's Plan card gets a sender line: who started the agent.
9. The agent keeps its automation's name when the run starts.
10. Pull-request and issue events get a fixed name. Everything else gets the model's name, with the automation's name as the placeholder.
11. The turn-end toast's second line is the automation's name.
12. A failed run is told to the automation's owner.
13. A failed run gets no Inbox item.
14. `AUTOMATION_PAUSE.FAILURES` is deleted.
15. MCP servers are one row in the Runs card, reusing the composer's servers popover.
16. The agent page gets the task column's side panel.
17. Planless agents aren't offered `edit_plan` or `show_page`.

## Chain A: the automation editor (built by the orchestrating worker)

Base: `main` after #2780. Against #2781 it conflicts on one line, the
lucide import list. Stacked in this order:

| PR | Items | Files |
| --- | --- | --- |
| A1 | 1–4: Owner first, with pictures; no owner line or owner crumb; the list's Owner column uses the same pictures | `desktop/automation-editor.tsx`, `desktop/automations-page.tsx`, `styles/desktop.css` |
| A2 | 5: every way out of an unsaved automation asks first (crumb, Escape, sidebar, ⌘[ / ⌘], ⌘K, opening a run) | `desktop/automation-editor.tsx`, `navigation-history.ts` (a leave guard `go` consults), the sidebar's opens |
| A3 | 6: the runs panel resizes and folds like the side panel. It uses `useResizableEdge`, keeps its width and fold in `localStorage` under `luke.automationRunsPanel`, and toggles with ⌥⌘B from the shell's panel-toggle slot | `desktop/automation-runs-panel.tsx`, `desktop/automation-editor.tsx`, `desktop/desktop-shell.tsx` |
| A4 | 23: runs and list rows wear their trigger's icon | `desktop/automation-runs-panel.tsx`, `desktop/automations-page.tsx` |
| A5 | 22: an automation's `disabledServers`, with an MCP servers row reusing `AgentServersButton` | `@luke/features` automation wire and draft model, the service's automation store and `startClaimed`, a migration, `desktop/automation-editor.tsx` |
| A6 | 20: a failed run's cause. The run summary's agent gains `failure` (`codingAgentFailureOf`), and `AGENT_FAILURE_WORDS` moves into `@luke/features` | `automation-wire.ts`, `automation-list-model.ts`, the service's run read, `planning/coding-agent-model.ts` |
| A7 | 21: delete `AUTOMATION_PAUSE.FAILURES` and its reads | `automation-wire.ts`, `automation-list-model.ts`, `automation-words.ts` |

Not production in the prototype:
- The runs-panel toggle sits at the toolbar's end.
- The MCP row keeps its choice in local state.
- The run's failure words are duplicated.
- The paused wording is hardcoded.

## Chain B: pickers

Base: `main`. Stacked:

| PR | Items | Files |
| --- | --- | --- |
| B1 | 7: drop the chooser's `source` heading | `planning/use-plans-tab.ts` (`repositoriesIn`), and `planning/repository-chip.tsx` if `source` goes from its type |
| B2 | 8: New task's workspace chip becomes `Picker` (from `settings/picker-row.tsx`), and its repository chip uses `CHIP_PLACE.FIELD` with a chevron. Both menus open below and left-aligned inside the dialog | `planning/new-plan-dialog.tsx`, `planning/repository-chip.tsx`, `styles/desktop.css` |

B2 has a one-line overlap with #2888 (the optional task name).

Not production in the prototype: the menu placement is a CSS override aimed at `.new-plan-dialog`.

## Chain C: the one-off agent page, find, and tools

Base: `main`. Stacked C1 → C2 → C3; C4 is independent:

| PR | Items | Files |
| --- | --- | --- |
| C1 | 11: read a repository's file tree and skills by workspace and repository, not only by plan | `@luke/features` planning view and acts, the host's act router, the service's tree and skills routes |
| C2 | 10, 11, 24: one agent pane used by the task column and the one-off agent page: `.desktop-agent` reading width, `FindScope`, a no-plan `PlanMentions` source (files, MCP servers, skills; no plan sections), the side panel (workers, Changes), `onOpenTarget`, cards, dictation keywords | `desktop/desktop-agent-page.tsx`, `desktop/main-tabs.tsx`, `desktop/desktop-plans.tsx`, `planning/plan-mentions.tsx`, `planning/mention-picker.tsx` (`planRows` skips an empty plan) |
| C3 | 12: `FindScope`'s subject becomes a place, and the shell mounts one scope around whichever page stands in the plan's place: Automations, Factory, Home, Inbox, the agent page, and version history. Settings keeps its search | `find-in-tab.tsx`, `desktop/desktop-shell.tsx`, those pages |
| C4 | 24: planless agents aren't offered `edit_plan` or `show_page` | the service's coder tool set |

Not production in the prototype:
- The agent page's `FindScope` subject is cast.
- The mention source's workspace slug and repository are hardcoded.

Coordination: the composer-drafts worker (`conductor/composer-drafts`) keys drafts by agent id. C2 doesn't change `useAgentComposer`.

## Chain D: one-off agents in the sidebar, and their notices

Base: `main`, with D2 stacked on worker 324's #2899 → #2904 → #2905.

| PR | Items | Files |
| --- | --- | --- |
| D1 | 9: read a workspace's one-off agents by the same rule as tasks | service and `@luke/features` |
| D2 | 9: one-off agents are rows inside Tasks, grouped by repository, creator, or none. The Created by filter and the Archived view cover them, and they sort with tasks by last activity. A row leads with its harness mark and ends with its starter's face (an automation's clock). Pinning waits for a later `agent_pin` | `@luke/ui/task-list-model` (rows generalised beyond `PlanSummary`), `desktop/desktop-sidebar.tsx` (`SidebarAgent` beside `SidebarPlan`) |
| D3 | 18: turn-end notices for one-off agents. The ledger watches D1's read and the toast's View takes an `AgentPlace`. The second line is the automation's name | `packages/host/src/agent-notices.ts`, `planning/agent-end-toast.ts`, `app.tsx` |
| D4 | 19: a run that fails to start posts the notice and the failed-tone toast to its owner. The sidebar's Automations row wears the failed mark until that automation is opened | service (run failure feed), host, `desktop/desktop-sidebar.tsx` |

Not production in the prototype: `window.__showAgents` and `window.__showFailedRuns` stand in for the reads.

## Chain E: integration logos

| PR | Items | Files |
| --- | --- | --- |
| E1 | 13: a `<provider>_remote` call shows its `ProviderMark`, its `remoteTool` as the subject, and its own input as the body. The `connection_execute` wrapper row is hidden where its nested call stands. The name-to-provider mapping moves into `@luke/features/integration-wire` | `planning/tool-call-model.ts`, `planning/transcript-blocks.tsx`, `planning/agent-tab.tsx`, `@luke/features` |

## Chain F: origins and naming

Base: `main`. Stacked F1 → F2 → F3.

| PR | Items | Files |
| --- | --- | --- |
| F1 | 16: an agent keeps its automation's name and its run's firing (one migration) | database, service, `@luke/features` coding-agent wire |
| F2 | 14–16: a transcript opens on its origin, drawn as a sent message from its actor, at a user message's measure | `planning/agent-tab.tsx`, `ai-elements` as needed, `styles/desktop.css` |
| F3 | 17: a pull-request or issue event's run takes a fixed name, its subject (`#2905 ⌘K view commands`; `Review #2905 …` for Code review), with no model. Other runs get the model's name: the model reads the prompt without the "Luke started this run…" line, plus the subject, and the placeholder is the automation's name | the service's `coder-host/title.ts` and automation runs |

**Dean's change to F2:** there is no Open automation, Open plan or Open task footer. The sender line's `ActorRef` is the link:
- **Who the sender is:** the automation, the task (for a plan brief, whoever started the agent), or the parent agent (for a subagent).
- **Hover and click:** its hover card is the existing ActorRef card, and a click navigates there.
- **Nothing to open:** where there's nothing to open (a deleted automation, someone else's personal automation, the Automations experiment off), the sender is plain text with no click.
- **GitHub subject:** the GitHub subject and its pull-request link stand in the sender line.

The fold holds the prompt alone. The prototype still draws the footer.

Not production in the prototype: the footer, and the prompt split on the boilerplate separator.
