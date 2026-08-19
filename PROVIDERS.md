# Provider capabilities

What Luke can see and do differs for every provider it connects to, and the
code cannot state that surface in one place: an adapter has a capability
exactly when it overrides the method, so the truth is spread across every
adapter. This document is the one written-down capability surface — what each
connection observes, what a session row can say, and which acts each provider
takes — for anyone deciding what Luke can do before reading eight adapters.
[AGENTS.md](AGENTS.md#provider-capability-documentation) states how it is kept
current; [PRIVACY.md](PRIVACY.md) covers the same connections from the data's
point of view and binds harder wherever the two could disagree.

## Where a capability lives in code

- `packages/sidecar-core/src/providers.ts` defines `SessionProviderAdapter`.
  `SessionProviderAdapterBase` answers unsupported — or none — for every act,
  so an adapter has a capability exactly when it overrides the method; there
  is no separate flags object to drift from the behavior.
- What a session can take right now is advertised per observation:
  `ProviderSessionObservation` in `packages/sidecar-core/src/session.ts`
  carries `canReceiveMessage`, `controls`, `spawnableAgents`, `workspace`,
  `recap`, `location`, and the address a row press opens. Every act is
  validated against the latest observation in the renderer and again in the
  main process, so the observed roster is the outer bound of what any ask can
  do.
- The agent kinds and models offerable when creating a workspace or adding an
  agent are the build-fixed table in
  `apps/desktop/src/shared/workspace-agents.ts`; credential shapes and
  connection kinds live in `apps/desktop/src/shared/credential-providers.ts`;
  adapters wire in through `apps/desktop/src/provider-registrations.ts`.

## Session providers at a glance

What each provider's sessions report:

| Provider | Id | Sessions | Credential | Lifecycle hook | Recap | Opens at |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code | `claude-code` | Local | None | `settings.json` merge | Designated away summary; archived sessions omitted when local `sessions-index.json` says so | — |
| Codex | `codex` | Local and cloud | None; cloud via the Codex CLI login | `hooks.json` merge, behind Codex's trust gate | Last agent message (local) | `codex:` thread link (local), task URL (cloud) |
| Conductor | `conductor` | Cloud | API key | — | Final assistant message, only while idle | `conductor:` deep link |
| Cursor | `cursor` | Local and cloud | Cloud only | — | Run result (cloud) | Agent URL (cloud) |
| Devin | `devin` | Local and cloud | Cloud only | — | — | Session URL (cloud) |
| GitHub Copilot | `copilot` | Cloud | Fine-grained PAT | — | — | Task page URL |
| Jules | `jules` | Cloud | API key | — | — | Session URL |
| OpenCode | `opencode` | Local | None | — | — | Share URL, once shared |

What each provider's sessions can take — every act only when the latest
observation advertised it, and only as the direct product of a turn the
developer opened:

| Provider | Message | Controls | New workspace | Add agent | Transcript readout |
| --- | --- | --- | --- | --- | --- |
| Claude Code | — | — | — | — | Yes |
| Codex | — | — | Yes, task required (cloud) | — | Yes, local sessions |
| Conductor | While idle or working | `cancel-turn`, `archive-workspace` | Yes, task optional | Yes | — |
| Cursor | After a finished run | `cancel-run`, `archive-agent` | Yes, task required | — | Yes, local sessions |
| Devin | While running or suspended | `archive-session` | — | — | Yes, local sessions |
| GitHub Copilot | — | — | — | — | — |
| Jules | In four documented states | `approve-plan` | — | — | — |
| OpenCode | — | — | — | — | Yes |

Transcript readout is Luke reading a local session's conversation aloud — or
into his composer — when asked about that session; a cloud session's
conversation lives with its provider and is never fetched. Every provider's
rows also carry the shared observation fields where the provider writes them:
title, status, repository, branch, model, current tool activity, error, a
change link such as a pull request, and the size of the change as its
provider counts it — files touched, lines added and removed — drawn beside
the checkout. Codex cloud tasks are the one source of those counts today.

## Claude Code

Local sessions, no credential. Luke reads bounded tails of the session JSONL
files under `~/.claude/projects/` (honoring `CLAUDE_CONFIG_DIR`), and never
writes them. The one provider-side write is the observation hook merged into
the user-level `settings.json`, which records a fixed status token per
session — start, prompt, stop, stop failure, permission notification, session
end — into a spool under Luke's own application data.

- Recap: only the away summary the provider itself designated; Luke never
  composes one from the assistant tail.
- Rows carry activity from the current tool call, repository, branch, model,
  API errors, and a pull-request change link.
- No address to open, no message path, no controls, no workspace acts.
- Transcript readout: yes (`apps/desktop/src/claude-code-transcript.ts`).

## Codex

Local sessions need no credential. Luke reads the read-only session index in
`state_5.sqlite` under `~/.codex` (honoring `CODEX_HOME`), skipping archived
threads — a chat filed away in Codex's own UI is not a row — then bounded
tails of each thread's rollout file. The observation hook merges into `hooks.json`
and runs only after Codex's own review gate shows it to the user and they
trust it; its events match Claude Code's minus stop failure.

Cloud tasks are the one CLI-observed surface: Codex documents no key-scoped
API, so observation runs the user's own Codex CLI — `codex login status` by
exit code alone, then `codex cloud list --json` — under the ChatGPT login the
user already gave that CLI. No token is read, stored, or forwarded, and a
machine whose CLI is absent or signed out is observed as having nothing. The
newest page is the roster; every few minutes a bounded walk of further pages,
following the CLI's own cursor, gathers the environments in recent use so
they can be offered for creation. The Connections page draws the login state
as a read-only row.

- Recap (local): the last agent message from the rollout tail; a failed turn
  reports its error instead. Cloud tasks carry none.
- Cloud rows are labelled by the environment's repository — the prompt-derived
  task title is discarded as transcript content — and map `pending` to
  working, `ready` and `applied` to complete, and `error` to a failure.
- Opens at `codex://threads/<id>` locally; a cloud task opens its
  `chatgpt.com` page.
- New workspace (cloud): a task started with `codex cloud exec --env`, in an
  environment the latest observation reported, by id where the list reports
  one and by label otherwise. The opening task is required — the prompt is
  the whole creation — a chosen name is refused because Codex names tasks
  itself, and the one thing read from the answer is the created task's id.
- No message path and no controls: Codex documents no way to message or steer
  a task already running, so the honest absence stands.
- Transcript readout: yes for local sessions
  (`apps/desktop/src/codex-transcript.ts`); a cloud task's conversation lives
  with its provider and is never fetched.

## Conductor

Cloud sessions under a user-supplied API key; nothing is observed without one.
Luke reads projects, workspaces, sessions, and their statuses from
`api.conductor.build`, plus one fixed read-only SQL document over the
transcripts view for each session's agent kind and recap tail. Conductor is
the one provider that reports `workspace`, so its chats group into a tray
named by the workspace, and the one provider whose sessions list
`spawnableAgents`.

- Message: while a session is idle or working.
- Controls: `cancel-turn` mid-turn; `archive-workspace` once every open chat
  in the workspace was seen settled.
- New workspace: in any project the latest pass reported, with an optional
  opening task delivered as the first message, and an agent, model, and
  effort chosen from the build's table.
- Add agent: another chat in an observed workspace, as one of the kinds its
  row's latest observation listed.
- Recap: the final assistant message's tail, only while the chat is idle.
- Opens through its `conductor:` deep link. No transcript readout — the
  conversation lives with the provider.

## Cursor

Two observers under one provider id. The local half reads bounded tails of
`~/.cursor/projects/<project>/agent-transcripts/*.jsonl`, labeling workspaces
from Cursor's own workspace storage; it reports turn state and failure —
without Cursor's reason, which is not stored — and offers no address and no
recap. Transcript readout renders what Cursor wrote down, which excludes tool
outputs. The cloud half reads agents and their latest runs from
`api.cursor.com` under `CURSOR_API_KEY`, with the repository list on its own
slower cadence.

- Message: a follow-up run, only after the latest run finished on an
  unarchived agent.
- Controls: `cancel-run` while a run is underway; `archive-agent` once the
  latest run positively settled. Never both at once.
- New workspace: a cloud agent in any repository the latest pass listed; the
  opening task is required because Cursor cannot make an idle workspace.
- Recap: the run result. Opens at the agent's URL; the run's pull request is
  the change link.

## Devin

Two observers under one provider id. The local half reads the Devin CLI's
read-only session database, reporting activity, repository, and model — no
address, no recap, no error detail. Transcript readout: yes, from the same
database. The cloud half reads the organization's sessions from
`api.devin.ai` v3 under a `cog_`-prefixed personal access token.

- Message: while a session is running or suspended and not archived.
- Controls: `archive-session`, offered only once the turn positively settled.
- Opens at the session URL; the pull request is the change link.
- No workspace acts, no recap.

## GitHub Copilot

Cloud agent tasks under a fine-grained personal access token, read from
`api.github.com`. The connection is fully read-only by design: no message
path, no controls, no workspace acts, no recap, no transcript readout. Rows
carry repository and branch, and open at the task's page URL.

## Jules

Cloud sessions under a user-supplied API key, read from
`jules.googleapis.com` — the one provider authenticated by Google's API-key
header rather than a bearer token.

- Message: while a session is planning, in progress, awaiting plan approval,
  or awaiting user feedback.
- Controls: `approve-plan`, only while the plan awaits approval.
- Opens at the session URL. No workspace acts, no recap, no transcript
  readout. Titles fall back to the repository label.

## OpenCode

Local sessions, no credential. Luke reads the read-only OpenCode database
(honoring `OPENCODE_DB`, falling back through the XDG data path and the
legacy JSON storage), skipping subagent and archived rows.

- No hook, no recap, no message path, no controls, no workspace acts.
- Opens at the session's share URL, once the user has shared it.
- Rows carry tool activity, repository, model, and turn failures.
- Transcript readout: yes (`apps/desktop/src/opencode-transcript.ts`).

## Integrations beyond sessions

**Linear** (`linear`) is connected by the tracker's own consent page — OAuth
with PKCE over a loopback redirect, never a typed key or an environment
variable — and reads one fixed GraphQL document for the user's assigned
issues. Each issue advertises its available state transitions and whether it
takes a comment, and the two acts — moving an issue to an advertised state,
adding a comment — run only as the direct product of a developer-opened turn,
validated against the observed issue roster in the renderer and again in the
main process. Disconnecting revokes the grant with Linear as well as deleting
it locally.

**Google Calendar** is the same consent shape with no write path at all:
per-account grants read the calendar list and free/busy intervals — start and
end instants only, so titles cannot even travel. The intervals drive exactly
one behavior: while a meeting covers now and Quiet during meetings is on,
spoken announcements hold and the face sleeps.

**OpenAI and the hosted account** carry voice and the optional attention
review. They are credential-only — nothing of theirs is ever observed as a
session — and the hosted account's daily allowance runs both until a
user-supplied OpenAI key takes over.

**The update check** is the one request made with no user key: an
unauthenticated read of this repository's latest release name from GitHub's
public API. Only the version name is read back, and it changes only what the
Updates row says.

## Keeping this document current

When a change adds a provider, widens or narrows what an adapter observes or
may do, or changes how a credential connects, this document changes in the
same commit. `scripts/provider-docs.test.mjs` refuses a provider or tracker
id this file does not name, and `scripts/repository-checks.sh` requires the
file to exist; everything subtler than an id's presence rests on the rule in
[AGENTS.md](AGENTS.md#provider-capability-documentation). Widening any
capability described here is a product decision, not an implementation
detail.
