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
- The ids the code knows these by: agents `claude-code`, `codex`, `conductor`,
  `copilot`, `cursor`, `devin`, `gemini-cli`, `jules`, and `opencode`; the
  Linear tracker `linear`; the Apple Calendar connection `apple-calendar`.

## Agents

An agent's local and cloud surfaces are observed separately and can do
different things, so each surface gets its own row.

What Luke reads:

| Agent | Surface | Reads | Recap | Transcript readout | Opens at |
| --- | --- | --- | --- | --- | --- |
| Claude Code | Local | Session files under `~/.claude/projects/` | Designated away summary | Yes | — |
| Codex | Local | Session index and rollout files under `~/.codex` | Last agent message, or the turn's error | Yes | `codex:` thread |
| Codex | Cloud | The user's own Codex CLI, under its ChatGPT login | — | — | `chatgpt.com` task page |
| Conductor | Cloud | `api.conductor.build`, under an API key | Final assistant message, while idle | — | `conductor:` deep link |
| Cursor | Local | Agent transcripts under `~/.cursor/projects/` | — | Yes | `cursor:` chat deep link, for the app's own chats |
| Cursor | Cloud | `api.cursor.com`, under `CURSOR_API_KEY` | Run result | — | `cursor:` deep link into the app |
| Devin | Local | The Devin CLI's session database | — | Yes | — |
| Devin | Cloud | `api.devin.ai`, under a `cog_` access token | — | — | Session URL |
| Gemini CLI | Local | Session recordings under `~/.gemini/tmp/<project>/chats/` | Last agent message | Yes | — |
| GitHub Copilot | Cloud | `api.github.com`, under a fine-grained PAT | — | — | Task page URL |
| Jules | Cloud | `jules.googleapis.com`, under an API key | — | — | Session URL |
| OpenCode | Local | The OpenCode database | — | Yes | Share URL, once shared |

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
| Gemini CLI | Local | — | — | — | — |
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

- **Claude Code** — bounded tails only, never written. The recap is only the
  summary the provider itself designated — Luke never composes one — and
  sessions the user archived are omitted.
- **Codex, local** — bounded tails only, read-only, skipping threads archived
  in Codex's own UI. While a Codex realtime voice conversation is live over a
  thread, it and the chats it delegated are neither announced nor
  attention-evaluated, and nothing from inside it is replayed. The hook merge
  runs only after Codex's own review gate shows it to the user and they trust
  it.
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
  which excludes tool outputs. A chat the Cursor app holds carries its own
  address, `cursor://anysphere.cursor-deeplink/agent?id=<chat>`, composed on
  this machine from the chat's observed id — the same route Cursor's
  deep-link handler resolves, opening the exact chat whether Cursor is
  running or not — and wears the app's own mark: Cursor on this Mac is an
  app as well as an agent — see [Apps](#apps). A chat the `agents` CLI
  started keeps no provider address — an app that manages its terminal
  stands its own in, the way cmux, Superset, and Conductor rows already do,
  and a CLI chat in an unmanaged terminal honestly opens nowhere, like every
  other terminal-only agent.
- **Cursor, cloud** — cancel and archive are never offered at once; a message
  is a follow-up run, only after the latest run finished on an unarchived
  agent; the new agent's task is required because Cursor cannot make an idle
  workspace. A row opens in the Cursor app — its press and its Cursor app
  mark share the one `/background-agent` address the app's own dashboard
  fires, composed from the observed agent id — and the agent page URL Cursor
  also reports is not offered, because two presses should not answer one row
  differently — see [Apps](#apps).
- **Devin** — the local database has no address, no recap, and no error
  detail; the cloud archive is offered only once the turn positively settled.
- **Gemini CLI** — bounded tails only (honoring `GEMINI_CLI_HOME`), never
  written, replayed the way the CLI's own resume replays them: `$set` metadata,
  `$rewindTo`, and a re-appended message superseding its earlier line. The
  session clock is the recording's own message stamps, never the `lastUpdated`
  bookkeeping the CLI appends to old sessions it merely listed. The workspace
  label comes from the `.project_root` marker; the title from the summary the
  CLI generates; a tool call held at `awaiting_approval` reads as waiting; the
  recap is a cleanly settled turn's parting words and nothing mid-turn.
  Subagent recordings stay inside the session that spawned them, and the
  whole-JSON recordings of pre-April-2026 builds — unreadable boundedly, and
  rewritten by the CLI itself on resume — are not read. No address, because
  Gemini CLI publishes no route that opens a session.
- **GitHub Copilot** — fully read-only by design.
- **Jules** — a message is taken while planning, in progress, awaiting plan
  approval, or awaiting user feedback.
- **OpenCode** — subagent and archived rows are skipped.

## Apps

An app's chats are observed by their own agents' adapters; the app's own state
is read solely for where those sessions live — and, for Conductor, whether the
user filed them away there. Matching is by exact provider session id — never
by title or filesystem path — and an absent app, an unreadable file, or a
schema this build does not know means no annotation.

| App | Reads | Adds to matched rows | Writes |
| --- | --- | --- | --- |
| ChatGPT | Nothing | A mark opening the exact Codex thread | None |
| cmux | Hook-session stores under `~/.cmuxterm` | Mark, exact `cmux:` pane address | None |
| Conductor | Local session index (`conductor.db`) | Mark, workspace grouping, `conductor:` chat address, filed-away filtering | None |
| Cursor | Chat-key presence in the app's own index | Mark and `cursor:` address opening the exact chat, on app-held local chats and every cloud agent | None |
| Orca | Hook-status cache and worktree names | Mark, worktree grouping | None |
| Superset | Host state (`host.db`) | Mark, grouping, `superset:` workspace address; a standing row for each unarchived worktree with no agent terminal | Message, open workspace, close terminal, add agent, new workspace, rename, delete workspace — through its CLI, while logged in |

### App notes

- **ChatGPT** — nothing of OpenAI's is observed; the mark exists because
  OpenAI's desktop app documents the route to the exact thread.
- **cmux** — the stores exist only where cmux's own agent hooks do — Claude
  Code's is injected by cmux's wrapper, the others only after the user runs
  `cmux hooks setup` — so a
  session cmux never recorded is honestly unannotated, and a store for an
  agent Luke has no provider for is not read. Only the three identifiers that
  place a session in cmux's windows are read. The pane address stands in as
  the row's own link where no other manager gave it one; no grouping, because
  cmux names its workspaces only by identifier; no writes, because cmux's
  control socket is password-guarded and undocumented for outside callers.
- **Conductor** — the index is never used to open an agent transcript, and a
  schema that predates workspaces annotates without grouping. The address,
  `conductor://workspace?id=<workspace>&session=<chat>`, is composed on this
  machine from the observed workspace and chat ids — the same deep link
  Conductor's own notifications fire — and stands in as the row's own link
  where the chat's agent gave it none; a sub-agent's address is its ancestor
  chat's, where its conversation lives in Conductor's window, and a
  pre-workspace schema has no workspace id to address, so its rows keep none.
  A chat the user filed away on Conductor's own surface — the chat hidden on
  its own, or its whole workspace archived — is dropped from the roster with
  its sub-agents, the same way the cloud adapter drops an archived
  workspace's chats: the agent's transcript outlives the chat the user
  already said goodbye to. Only Conductor's positive record drops a row; an
  absent app, an unreadable index, or a schema too old to say leaves every
  observation standing. Conductor documents no message endpoint for a local
  chat, so the association adds no send control.
- **Cursor** — the agent's own app, riding the rows it can open the way
  ChatGPT rides a Codex chat: the agent stays the row's identity, and the
  mark's press opens the exact chat in the app. A local chat qualifies when
  the app's own index holds it — read as the presence of the chat's key
  alone, because the values are the conversations, and observation never
  opens message content — through the handler's `/agent` route; every cloud
  agent qualifies through its `/background-agent` route, the same address
  Cursor's own dashboard fires, composed here from the observed agent id. The
  app deliberately keeps its own filter id rather than the agent's: the app
  chip counts the chats the Cursor app can open, the agent chip every Cursor
  chat, and the two chips narrow each other across their axes. A chat the
  `agents` CLI started registers in no window, so it carries no Cursor app
  mark and none of the app's address.
- **Orca** — the hook-status cache also carries conversational fields — the
  last prompt, a message preview, a tool's input — and none of them are ever
  read. A sub-agent
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
  ask is taken and reported as the delete it is. A worktree workspace with no
  agent terminal at all is settled by construction, so it stands as its own
  row — read from the same host state, titled by the workspace, opening at
  its `superset:` address, taking the same rename, add-agent, and delete
  while logged in, and never taking a message, because no terminal exists to
  land one. The main checkout and workspaces Superset itself archived draw no
  row: the one is the user's own working copy, the other already filed away.
  Connect and Disconnect are
  the CLI's own `auth login` and `auth logout` at the developer's press on the
  Superset row; the CLI owns the credential throughout, and signing out
  withdraws every act while observation continues unchanged.

## Other connections

| Connection | Reads | Writes |
| --- | --- | --- |
| Linear | The user's assigned issues, under an OAuth grant | Move an issue to an advertised state; add a comment |
| Google Calendar | Calendar list and free/busy instants, per signed-in account | None |
| Apple Calendar | This Mac's calendar list and event instants, behind macOS's own consent | None |
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
