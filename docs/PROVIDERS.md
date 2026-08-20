# Provider capabilities

Luke tells agents from apps: an **agent** is a session provider — the thing a
conversation belongs to — and an **app** holds agent sessions without becoming
their provider, the way a Codex chat stays a Codex chat inside Conductor or
Superset. This document is the one written-down answer to what Luke **reads**
and what he may **write**, per agent and per app.
[packages/providers/AGENTS.md](../packages/providers/AGENTS.md#provider-capability-documentation)
states how it is kept current; [PRIVACY.md](../PRIVACY.md) covers the same
connections from the data's point of view and binds harder wherever the two
could disagree.

## Where a capability lives in code

- `packages/session/src/providers.ts` defines `SessionProviderAdapter`. The
  base answers unsupported — or none — for every act, so an adapter has a
  capability exactly when it overrides the method; there is no flags object to
  drift from the behavior.
- What a session can take right now rides its latest
  `ProviderSessionObservation` (`packages/session/src/session.ts`). Every act
  is validated against that observation in the renderer and again in the main
  process, so the observed roster is the outer bound of what any ask can do.
- Apps are the `SESSION_APPLICATION_ID` set in the same file; offerable agent
  kinds and models are the table in
  `packages/session/src/workspace-agents.ts`; credential shapes live in
  `packages/credentials/src/credential-providers.ts`; adapters wire in through
  `packages/providers/src/registrations.ts`, with each transcript reader at
  `packages/providers/src/<agent>/transcript.ts`.

## Agents

An agent's local and cloud surfaces are observed separately and can do
different things, so each surface gets its own row.

What Luke reads:

| Agent | Surface | Reads | Recap | Transcript readout | Opens at |
| --- | --- | --- | --- | --- | --- |
| Claude Code (`claude-code`) | Local | Session files under `~/.claude/projects/` | Designated away summary | Yes | — |
| Codex (`codex`) | Local | Session index and rollout files under `~/.codex` | Last agent message, or the turn's error | Yes | `codex:` thread |
| Codex | Cloud | The user's own Codex CLI, under its ChatGPT login | — | — | `chatgpt.com` task page |
| Conductor (`conductor`) | Cloud | `api.conductor.build`, under an API key | Final assistant message, while idle | — | `conductor:` deep link |
| Cursor (`cursor`) | Local | Agent transcripts under `~/.cursor/projects/` | — | Yes | — |
| Cursor | Cloud | `api.cursor.com`, under `CURSOR_API_KEY` | Run result | — | Agent URL |
| Devin (`devin`) | Local | The Devin CLI's session database | — | Yes | — |
| Devin | Cloud | `api.devin.ai`, under a `cog_` access token | — | — | Session URL |
| GitHub Copilot (`copilot`) | Cloud | `api.github.com`, under a fine-grained PAT | — | — | Task page URL |
| Jules (`jules`) | Cloud | `jules.googleapis.com`, under an API key | — | — | Session URL |
| OpenCode (`opencode`) | Local | The OpenCode database | — | Yes | Share URL, once shared |

Transcript readout is Luke reading a local session's conversation aloud — or
into his composer — when asked; a cloud session's conversation lives with its
provider and is never fetched. Every row also carries the shared fields where
its provider writes them: title, status, repository, branch, model, current
tool activity, error, a change link such as a pull request, and the change's
size as the provider counts it.

What Luke may write — every act only when the latest observation advertised
it, and only as the direct product of a turn the developer opened:

| Agent | Surface | Message | Controls | Workspace acts | Hook merge |
| --- | --- | --- | --- | --- | --- |
| Claude Code | Local | — | — | — | `settings.json` |
| Codex | Local | — | — | — | `hooks.json` |
| Codex | Cloud | — | — | New task (prompt required) | — |
| Conductor | Cloud | While idle or working | Cancel turn, archive workspace | New workspace (task optional), add agent, rename workspace or chat | — |
| Cursor | Local | — | — | — | — |
| Cursor | Cloud | After a finished run | Cancel run, archive agent | New agent (prompt required) | — |
| Devin | Local | — | — | — | — |
| Devin | Cloud | While running or suspended | Archive session | — | — |
| GitHub Copilot | Cloud | — | — | — | — |
| Jules | Cloud | In four documented states | Approve plan | — | — |
| OpenCode | Local | — | — | — | — |

A hook merge is the one write a local surface makes: an observation hook
merged into the provider's own user-level configuration, recording fixed
per-session status tokens — start, prompt, stop and its failure, permission,
end — into a spool under Luke's own application data. An app can widen a
local row past this table: a Superset-managed chat gains an address, a message
path, and workspace acts through Superset's CLI — see [Apps](#apps).

### Agent notes

The bounds the tables cannot carry:

- **Claude Code** — bounded tails only, honoring `CLAUDE_CONFIG_DIR`, never
  written. The recap is only the summary the provider itself designated — Luke
  never composes one — and archived sessions are omitted when the local
  `sessions-index.json` says so.
- **Codex, local** — the read-only index in `state_5.sqlite` (honoring
  `CODEX_HOME`), skipping threads archived in Codex's own UI, then bounded
  rollout tails. Each thread also carries a ChatGPT app association with its
  own `codex:` address. A thread spawned by another is its own row, linked by
  the `parent_thread_id` Codex persists, and a delegated chat is labelled by a
  name Codex actually keeps — never the raw marker. While a Codex realtime
  voice conversation is live over a thread, it and the chats it delegated are
  neither announced nor attention-evaluated, and nothing from inside it is
  replayed. The hook merge runs only after Codex's own review gate shows it to
  the user and they trust it.
- **Codex, cloud** — Codex documents no key-scoped API, so observation runs
  the user's own CLI — `codex login status` by exit code alone, then
  `codex cloud list --json` — and no token is read, stored, or forwarded; an
  absent or signed-out CLI is observed as having nothing. Rows are labelled by
  the environment's repository — the prompt-derived title is discarded as
  transcript content. The one write is a new task through
  `codex cloud exec --env` in an environment the latest observation reported:
  the prompt is the whole creation, a chosen name is refused because Codex
  names tasks itself, and only the created task's id is read back. Codex
  documents no way to message or steer a running task, so the honest absence
  stands.
- **Conductor** — beside the session roster, one fixed read-only SQL document
  over the transcripts view yields each chat's agent kind and recap tail.
  Conductor hosts agents rather than being one: a chat whose kind maps to
  Claude Code, Codex, Cursor, or OpenCode reports that agent as its identity,
  with the Conductor mark riding as an app association. Archive is offered
  once every open chat in the workspace was seen settled; renames go to a name
  the developer chose; a new workspace takes its agent, model, and effort from
  the build's table. Conductor on this Mac is an app — see [Apps](#apps).
- **Cursor, local** — rows report turn state and failure without Cursor's
  reason, which is not stored, and the readout renders what Cursor wrote down,
  which excludes tool outputs.
- **Cursor, cloud** — cancel and archive are never offered at once; a message
  is a follow-up run, only after the latest run finished on an unarchived
  agent; the new agent's task is required because Cursor cannot make an idle
  workspace.
- **Devin** — the local database has no address, no recap, and no error
  detail; the cloud archive is offered only once the turn positively settled.
- **GitHub Copilot** — fully read-only by design.
- **Jules** — the one provider authenticated by Google's API-key header; a
  message is taken while planning, in progress, awaiting plan approval, or
  awaiting user feedback, and titles fall back to the repository label.
- **OpenCode** — honors `OPENCODE_DB`, falling back through the XDG data path
  and the legacy JSON storage; subagent and archived rows are skipped.

## Apps

An app's chats are observed by their own agents' adapters; the app's own state
is read solely for where those sessions live. Matching is by exact provider
session id — never by title or filesystem path — and an absent app, an
unreadable file, or a schema this build does not know means no annotation.

| App | Reads | Adds to matched rows | Writes |
| --- | --- | --- | --- |
| ChatGPT | Nothing | A mark opening the exact Codex thread | None |
| cmux | Hook-session stores under `~/.cmuxterm` | Mark, exact `cmux:` pane address | None |
| Conductor | Local session index (`conductor.db`) | Mark, workspace grouping | None |
| Orca | Hook-status cache and worktree names | Mark, worktree grouping | None |
| Superset | Host state (`host.db`) | Mark, grouping, `superset:` workspace address | Message, open workspace, close terminal, add agent, new workspace, rename, delete workspace — through its CLI, while logged in |

### App notes

- **ChatGPT** — nothing of OpenAI's is observed; the mark exists because
  OpenAI's desktop app documents the route to the exact thread.
- **cmux** — the stores (honoring `CMUX_AGENT_HOOK_STATE_DIR`) exist only
  where cmux's own agent hooks do — Claude Code's is injected by cmux's
  wrapper, the others only after the user runs `cmux hooks setup` — so a
  session cmux never recorded is honestly unannotated, and a store for an
  agent Luke has no provider for is not read. Only the three identifiers that
  place a session in cmux's windows are read. The pane address stands in as
  the row's own link where no other manager gave it one; no grouping, because
  cmux names its workspaces only by identifier; no writes, because cmux's
  control socket is password-guarded and undocumented for outside callers.
- **Conductor** — the index at
  `~/Library/Application Support/com.conductor.app/conductor.db` is never used
  to open an agent transcript, and a schema that predates workspaces annotates
  without grouping. Conductor documents no exact address or message endpoint
  for a local chat, so the association adds no open or send control.
- **Orca** — reads the hook-status cache
  (`~/Library/Application Support/orca/agent-hooks/last-status.json`) and the
  worktree names in `orca-data.json`; the cache's conversational fields — the
  last prompt, a message preview, a tool's input — are never read. A sub-agent
  inherits through its provider's own parent record, and a chat another
  manager already groups keeps that workspace with the Orca mark on the row
  alone.
- **Superset** — every act runs the CLI's documented command, invoked directly
  without a shell, in a developer-opened turn, carrying only observed
  identifiers beside the developer's own words; the login serves one
  organization at a time, so only rows its own host database recorded offer
  any act. Rename is `workspaces update` with `--name` alone — never the
  command's other flags. Delete (`workspaces delete`, the observed workspace
  id its single argument) is permanent — Superset documents no archive — and
  takes every chat in the workspace, so it is offered only on a row positively
  seen settled, carried once on a grouped tray's header, and an archive-worded
  ask is taken and reported as the delete it is. Connect and Disconnect are
  the CLI's own `auth login` and `auth logout` at the developer's press on the
  Superset row; the CLI owns the credential throughout, and signing out
  withdraws every act while observation continues unchanged.

## Other connections

| Connection | Reads | Writes |
| --- | --- | --- |
| Linear (`linear`) | The user's assigned issues, under an OAuth grant | Move an issue to an advertised state; add a comment |
| Google Calendar | Calendar list and free/busy instants, per signed-in account | None |
| Apple Calendar (`apple-calendar`) | This Mac's calendar list and event instants, behind macOS's own consent | None |
| OpenAI and the hosted account | Nothing — credentials for voice and the attention review only | None |
| The updater | This repository's release manifest, unauthenticated | Installs the verified download at a quit |

- **Linear** — connected by the tracker's own consent page, OAuth with PKCE
  over a loopback redirect — never a typed key or an environment variable —
  and present only in a build carrying a registered OAuth client. One fixed
  GraphQL document reads the issues; each issue advertises its available state
  transitions and whether it takes a comment, the two acts run only as the
  direct product of a developer-opened turn, validated against the observed
  issue roster in the renderer and again in the main process, and
  disconnecting revokes the grant with Linear as well as deleting it locally.
- **Google Calendar** — the same consent shape with no write path: start and
  end instants only, so titles cannot even travel. The intervals drive exactly
  one behavior — while a meeting covers now and Quiet during meetings is on,
  spoken announcements hold and the face sleeps.
- **Apple Calendar** — the same read taken locally, with no credential at all:
  a native EventKit helper, behind macOS's own consent dialog, reads this
  Mac's calendar list and the start and end instants of events on the
  calendars the user chose. EventKit publishes no free/busy, so the narrowing
  happens in the helper — titles, attendees, and notes die inside its process,
  and intervals are all that ever reach Luke. One connection at most, because
  the Mac's Calendar already aggregates every account macOS holds;
  disconnecting deletes the stored choice, and the system grant stays the
  user's own in System Settings. The intervals are pooled with Google's and
  drive the same one behavior.
- **The updater** — the feed address is fixed by the build and the fetch
  carries nothing about the user; a newer build downloads from the same
  release, checksum-verified against the manifest and signature-verified
  against the running app, and a failure falls back to the releases page in
  the browser.

## Keeping this document current

When a change adds an agent or app, widens or narrows what an adapter observes
or may do, or changes how a credential connects, this document changes in the
same commit. `scripts/provider-docs.test.mjs` refuses a provider or tracker id
this file does not name, and `scripts/repository-checks.sh` requires the file
to exist; everything subtler than an id's presence rests on the rule in
[packages/providers/AGENTS.md](../packages/providers/AGENTS.md#provider-capability-documentation).
Widening any capability described here is a product decision, not an
implementation detail.
