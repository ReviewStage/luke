# Proposal: one agent runtime for the planning brain and coding agents

Status: decided by Dean on 2026-10-13 (see "Decisions" below), being built
as the PR plan in §5 describes. Where what ships differs from the proposal,
the text says what shipped. Based on main at `b057304a`.

Dean's ask: "I feel like we always have to design for both brain and coding
agents. But in my mind they should essentially be the same infrastructure.
Can we pause and discuss why they are different and how we can unify them?"

## TL;DR

- **Most of the infrastructure is already shared.** The two agents share the
  auth walk, the relay into the store, the provider model code, titles, the
  clone, sandbox cleanup, session retirement, the integration connection, the
  `conversations`/`messages`/`turns` tables, and the desktop's row fold and
  transcript blocks (§1.1).
- **The duplication sits at three seams:**
  1. **The eve edge files.** Every slot is authored twice per root and twice
     again per worker. Integrations alone take 16 connection files for 4 MCP
     servers.
  2. **The host facades.** `BrainHost` and `CoderHost` are separate, and so
     are the two tool registries.
  3. **The transcript.** There are two wires, a push wire and a pull wire,
     and two adapter layers over the same React blocks.
- **Most differences are accidents of history** (§2). Three are fundamental:
  - The live voice front end (GPT Live, the notetaker, following the journal).
  - The planner's latency budget.
  - Repository write access.
- None of these needs a second agent runtime. Each is either a layer in front
  of the runtime (voice) or a field of a role profile (latency, write access).
- **Recommendation: one agent runtime with four roles,** `planner`,
  `planner-worker`, `coder`, `coder-worker`. Roles differ only by a
  `RoleProfile`: model policy, instructions, tool allow-list, connection
  policy, sandbox policy, delegation mode.
  - One tool registry in which every tool declares its roles.
  - One connection builder.
  - One sandbox lifecycle.
  - One subagent mechanism.
  - One transcript wire and one transcript component (the Work tab becomes
    the planner's agent tab).
- **Keep two eve roots (two mounts) for now, as thin shells over that
  runtime.** Merge them into one eve root and deployment only once the
  runtime is shared and coder sessions can rotate (§3.9).
  - eve's filename discovery and its static per-node fields make a shared
    root possible but not free.
  - Two deployments keep voice latency and the blast radius isolated.
- **First three PRs:** one connection set, one tool registry with roles, one
  transcript part view (§5).

## 1. What exists today

| Concern | Planning brain | Coding agent |
| --- | --- | --- |
| **eve root** | `apps/web/eve/`. Service `eve`, mount `/eve` (`apps/web/vercel.json` services; `brain-host/eve-sessions.ts:64-67` `EVE_MOUNT`) | `apps/web/coder/`. Service `coder`, built with `EVE_PUBLIC_ROUTE_PREFIX=/eve/coder` and rewritten to `/eve/v1/*` (`vercel.json`) |
| **Agent config** | `eve/agent.ts`: `defaultTools:false`, uncapped limits, compaction at 0.8 (`BRAIN_HOST.COMPACTION_THRESHOLD`), retention 0 | `coder/agent.ts`: the same, except compaction at 0.9 (`CODER.COMPACTION_THRESHOLD_SHARE`) |
| **Who opens a turn** | Only the voice service, and only as a `spoken` turn. `DEPLOYMENT_TURNS` admits spoken and refuses typed (`brain-host/channel.ts:75-84`). Path: `brain-ask.ts:215-294` `acceptAsk` → `dispatchOnce` → eve over HTTP as the deployment (`voice/deployment-exchange.ts:112-118`) | The developer's bearer from the agent tab (`coding-agents-app.ts:387` → `coder-host/start.ts:111-171`), or the brain's `start_coding_agent`/`message_coding_agent` as the deployment. `CODER_DEPLOYMENT_TURNS` admits typed only (`coder-host/channel.ts:85`) |
| **Deployment presence** | `DEPLOYMENT` (`eve/channels/eve.ts:23`) | `ACCOUNT` plus a carrier attribute (`coder/channels/eve.ts:25-26`; `brain-host/auth.ts:180-190`) |
| **Host facade** | `BrainHost` (`brain-host/host.ts:140-213`, 499 lines) | `CoderHost` (`coder-host/host.ts:128-245`, 571 lines) |
| **Edge doors** | `eve/host.ts` (71 lines): `seams`, `host`, `relayChildEvent`, `integrationConnectionFor` | `coder/host.ts` (168 lines): the same four, plus `makeDelegation`, `selectDelegatedModel`, `editPlanNotes`, `runInboxTool`, `sessionSkills` |
| **Tools** | One dynamic resolver, `eve/tools/brain.ts`. `hostedTools()` on `turn.started` maps `PLANNING_TOOLS` (`brain-host/planning.ts:429-487`, 13 tools) through `host.runTool` | 15 static files under `coder/tools/`, one per `CODER_TOOL` entry (`coder-host/tool-set.ts:33`) |
| **Stored tool set** | `HOSTED_TOOL_SET = planningToolSet()` (`brain-tool-set.ts:9`; `planning.ts:566-578`): the planning tools, eve's `worker`/`task_wait`/`task_cancel`, and the connection tools | `CODER_TOOL_SET` (`tool-set.ts:114`): `CODER_TOOL` plus the connection tools |
| **Worker** | `eve/subagents/worker/`: visible, run by eve as a background task. Its tools come from `hostedTools(WORKER_TOOL_NAMES, host.admitDelegated)` (`planning.ts:534-538`: `search_web`, `read_web_page`, `run_in_repository`). Fixed model | `coder/subagents/worker/`: hidden (`tool:false`), reached only through the `delegate` workflow tool (`coder/tools/delegate.ts`), which blocks the turn. Its own 6 tool files (`tool-set.ts:58`). Model and effort chosen per delegation (`coder-host/delegation.ts`; `coding_agent_delegation`) |
| **Subagent tools in rows** | `worker`, `task_wait`, `task_cancel` (`planning.ts:498-502`) | `delegate` |
| **Connections** | `eve/connections/{linear,notion,sentry,slack}.ts` and `eve/subagents/worker/connections/*`: static, always on | `coder/connections/*` and `coder/subagents/worker/connections/*`: `switchableConnection` per turn, honoring `disabled_servers` (`coder-host/servers.ts:56-100`) |
| **Skills** | None | `coder/skills/repository.ts`, dynamic on `session.started` (`coder-host/skills.ts:43`; `repository-skills.ts`), plus `load_skill` |
| **Instructions** | `PLANNING_INSTRUCTIONS` (`planning.ts:117-236`), set at session start. `standingContext` added per turn (plan, board, recent agent edits: `planning.ts:356-373`). `seed.ts` on rotation. `WORKER_INSTRUCTIONS` (`planning.ts:548-554`) | `coderInstructions` (`coder-host/instructions.ts:92`) at session start. The plan is the first message. `coderWorkerInstructions` (`:137`) |
| **Model** | `openai/gpt-6.1-sol` at medium (`packages/brain/src/model-defaults.ts:11-14`), always on Luke's key. Selected by calling `coderModel` with no account key (`brain-host/model.ts:65-80`) | The agent row's choice from the catalog: Claude or Codex, `-fast` slugs for Anthropic (`model-catalog.ts:69-77`). BYOK through `accountKeyMiddleware` (`coder-host/model.ts:176, 233`) |
| **Metering** | `meteredMiddleware` → `spendHostedMeter` on every inference (`brain-host/model.ts:31-58`; `production.ts:83`). Counts, never refuses | None. `usage.ts` prices recorded usage for display only |
| **Sandbox** | `eve/sandbox.ts`: image prepared with git only. Opened lazily; depth-1 clone with a **read** token on the first `run_in_repository`/`show_code` (`repository-shell.ts:286, 459-489`). Never stopped by Luke | `coder/sandbox.ts`: code tooling, pnpm and python, 4 vCPU, 24 h timeout. Eager **full** clone with a **write** token at open (`coder-host/checkout.ts:161`), credential renewed at the firewall every 50 min, stopped at every turn's end, branch recorded (`coder/hooks/store.ts`) |
| **Hooks** | `eve/hooks/store.ts`: relay only. Worker hook relays its child session and titles it | `coder/hooks/store.ts` (149 lines): relay, title, sandbox stop, credential renewal, branch record. Worker hook relays and pins `parentCallId` |
| **Session lifetime** | No eve timeout. Rotates when eve answers `RETIRED` or not-ready (`brain-ask.ts:260-282`); the new session is seeded from the store (`host.seed`) | No eve timeout. No seed path. Lives until archived or the plan is deleted |
| **Transcript store** | The plan's conversation (`plan.conversation_id`). Worker in `childConversationId(parent, callId)` (`brain-host/host.ts:450-477`) | The agent's conversation (kind `coding_agent`). Workers in child conversations under the same function |
| **Transcript wire** | A typed, bounded server projection `planWorkOf` (`voice/plan-work.ts:403`) → `planWorkTurnSchema` (`packages/features/src/planning-view.ts:118-273`). Pushed: `GET /api/plans/{id}/work?before=` plus the live `plan.work` socket frame, into `app:state` | Raw stored AI SDK parts (`coding-agent-wire.ts:620-821`). Pulled: held `GET /api/agents/{id}/messages?after=` (`coder-host/transcript.ts:436`) |
| **Transcript UI** | Work tab, `planning/plan-work.tsx` (535) and `work-model.ts` (427) | Agent tab, `planning/agent-tab.tsx` (816), `coding-agent-model.ts` (1,118) and `tool-call-model.ts` (531) |
| **Plan writing** | The brain never writes the plan (`planning.ts:144`). The notetaker does: `voice/plan-scribe.ts`, `gpt-5.6-luna`, inside the voice service, through `saveNotes` (`plan-notes.ts:248`) | `edit_plan` reuses the notetaker's schema and `saveNotes`, capped per turn (`coder-host/plan-edit.ts`) |
| **Evals** | `eve/evals/brain-host.eval.ts` plus `eve/scripted-model.ts` (139 lines) | `coder/evals/coder.eval.ts` plus `coder/scripted-model.ts` (140 lines) |

### 1.1 Already shared (the premise is half true)

The two agents already stand on one infrastructure in more places than it
looks.

| What is shared | Where |
| --- | --- |
| Auth walk | `ownedAuth([deploymentActor, lukeAccount, localDev], ownership)` (`brain-host/door.ts:76-112`), used by both channels |
| Stream → store | One `StreamRelay` for both (`brain-host/relay.ts`, 1,116 lines; `coder-host/host.ts:31, 357`) |
| eve session client | `EveSessions` (`brain-host/eve-sessions.ts`), with `EVE_MOUNT` naming both mounts |
| Model selection | The brain calls the coder's `coderModel` (`brain-host/model.ts:65-80`) |
| Titles | The brain's worker titles call `titleSubagent` (`brain-host/host.ts:29, 496`) |
| Async-context pinning | `brain-host/pinned-state.ts`, used by all six hooks and resolvers |
| Clone | `cloneRepository` (`repository-shell.ts:367`) |
| Sandbox deletion and retirement | `session-sandboxes.ts`, `retire-sessions.ts` (which choose a mount by conversation kind) |
| Integrations | `integrationConnection` (`integration-connection.ts:167`); `connectionToolEntries` in both stored tool sets |
| Storage | `conversations`, `messages`, `turns` and child conversations (`packages/database/src/schemas/storage.ts`) |
| Desktop rows | `turn-rows.ts` (`turnRows`, `CALL_KIND`; its header says it exists so the two tabs never drift) and `transcript-blocks.tsx` (`TranscriptTool`, `TranscriptSubagent`, `TranscriptRows`, …) |

`coder-host/` imports `brain-host/` for auth, bounds, channel, door,
conversation, host types, relay and eve-sessions. `brain-host/` imports
`coder-host/` back for `coderModel`, `titleModel` and `titleSubagent`. The
code already acts as one runtime split across two folders.

### 1.2 What is duplicated

| Duplication | Count today | Evidence |
| --- | --- | --- |
| Connection files | 16 (4 providers × 4 agent nodes), differing only in admission and switchability | `eve/connections/*`, `eve/subagents/worker/connections/*`, `coder/connections/*`, `coder/subagents/worker/connections/*` |
| `integrationConnectionFor` | 2 | `eve/host.ts:64-71`, `coder/host.ts:158-168` |
| Tool registries | 2 (`PLANNING_TOOLS`/`planningToolSet`, `CODER_TOOL`/`CODER_TOOL_SET`) | `planning.ts:429-578`, `tool-set.ts:33-120` |
| `WORKER_TOOL_NAMES` | 2, same name, different sets | `planning.ts:534`, `tool-set.ts:58` |
| Same job, two tools | Web: `search_web` + `read_web_page` (hosted, screened, cited, budgeted, Luke's key; `public-research.ts`) vs eve's `web_search` + `web_fetch` (provider-run). Repository reads: `run_in_repository` (one shell, 60 s, 20 k chars) vs `bash`/`read_file`/`glob`/`grep` | `planning.ts:443-457`; `coder/tools/*` |
| Subagent mechanisms | 2 (eve's visible subagent tool vs a hidden worker behind a workflow tool), each with its own relay cases, row kind (`worker` vs `delegate`) and desktop adapter | `eve/subagents/worker/agent.ts`, `coder/tools/delegate.ts` |
| Hosts | 2 facades (`BrainHost`, `CoderHost`), 2 seam sets (`production.ts` × 2), 2 `host.ts` edges | above |
| Channels | 2 `channel.ts` and 2 deployment-turn tables, differing in which turn kind the deployment may open and which presence it takes | `brain-host/channel.ts:75-84`, `coder-host/channel.ts:85-110` |
| Store hooks and prompt resolvers | 4 relay hooks, 2 prompt resolvers, 2 `session-prompt.ts` | `*/hooks/store.ts`, `*/instructions/prompt.ts` |
| Sandbox selectors | 2 images and 2 selectors | `eve/sandbox.ts`, `coder/sandbox.ts` |
| Transcript wires | 2 (`planning-view.ts` push projection vs `coding-agent-wire.ts` pull of raw parts), 2 routes, 2 desktop data paths (`compose-planning.ts` vs `compose-coding-agents.ts`) | §1 table |
| Desktop adapters over the shared blocks | Pairs: `WorkBlock`/`AgentPart`, `WORK_READING`/`AGENT_READING`, `CALL_KIND_OF_TOOL` (plus server `TOOL_OF_NAME`)/`AGENT_TOOL`, `WorkBlockView`/`AgentPartView`, `WorkCall`/`ToolCallView`, `WorkerLine`/`DelegationRow`, `SubagentTab`/`AgentSubagentTab`, inline task card/`PlanCard`, `EarlierWork`/cursor paging, end words | `plan-work.tsx`, `work-model.ts`, `agent-tab.tsx`, `coding-agent-model.ts` |
| Metering | 2 policies (brain meters, coder doesn't; coder prices, brain doesn't) | §1 table |
| Instructions | 4 prompts, sharing fragments by import (`COMMAND_DESCRIPTION_INSTRUCTION`, `INTEGRATION_NAMES_SAID`) | `planning.ts`, `coder-host/instructions.ts` |
| Scripted fixture models | 2, near-identical skeletons | `eve/scripted-model.ts`, `coder/scripted-model.ts` |

## 2. Why they differ: fundamental vs accidental

| Difference | Fundamental? | Why |
| --- | --- | --- |
| **A live voice call vs unattended work** | **Fundamental for the front end, not for the agent.** | The planner's turn is an ordinary eve turn. What is special is the layer in front of it: GPT Live delegating asks (`packages/voice/.../live-session-service.ts:1095, 1314`), the voice following the turn row and journal every 250 ms (`voice/live-brain.ts`), `queue_question`/`end_call` carried by the journal, and the notetaker. That layer stays separate (§4); the agent behind it needn't. |
| **Latency** | **Fundamental, as configuration.** | The planner must answer at conversational speed. Delegation must not block (eve background tasks), effort stays at medium, the tool list stays short and stable for the prompt cache, and sentences are released one at a time. All of this is profile data (model policy, `delegation: background`, tool allow-list), not a second runtime. |
| **Writing the plan vs editing a repo** | **Mostly accidental.** | Neither agent's loop writes the plan. The notetaker writes it during a call, and a coder's `edit_plan` writes through the same `saveNotes`. What really differs is repository access: a read token and a depth-1 clone vs a write token, a full clone and a branch. That is sandbox policy. |
| **Models and keys** | **Accidental.** | The brain is pinned to GPT-6.1-sol on Luke's key and already goes through `coderModel`. BYOK for the planner, or a catalog choice, is a product decision, not an architectural one. Metering only the brain is an accident of order: the meter predates coders. |
| **Attended approval** | **A runtime fact, not a role.** | "Is the developer present?" is a property of the moment: a call is live, or the desktop is reading the agent. The Mac-commands design assumes every brain turn has a call (`docs/proposals/mac-commands.md` on its branch). The coder already has an attended-approval channel: the inbox, whose answer steers the agent (`coding-agents-app.ts:820-850`). |
| **Session lifetime** | **Accidental.** | Neither has an eve timeout, and both retire on deletion. Only the brain rotates and seeds on `RETIRED`. Only the coder stops its sandbox at each turn's end. Each lacks the other's half. |
| **Turn kinds and deployment presence** | **Accidental.** | `spoken` vs `typed`, and presence `DEPLOYMENT` vs `ACCOUNT`, came from the order things were built. The turn kind is a field of the turn, not of the agent. |
| **What the UI shows** | **Accidental.** | Both read the same `messages` rows and child conversations. The Work tab's typed projection and the agent tab's raw parts are two readings of one store. |
| **Compaction threshold (0.8 vs 0.9)** | **Accidental.** | |
| **Subagent mechanism** | **Accidental, with one real difference.** | The planner's worker must not block (latency). The coder's delegation blocks by design and chooses a model. eve 0.74 workflow tools can run either way: `execute` blocks and `task` returns a receipt (`eve/docs/tools/workflows.mdx`, "Run calls as tasks"). |

## 3. The proposed shape

### 3.1 Roles and profiles

There is one runtime module, `apps/web/server/hosted/agent-runtime/`, and every
eve slot of every agent node is a thin call into it.

```ts
/** role.ts -- the four agents Luke runs, and what sets each apart. */
export const AGENT_ROLE = {
  PLANNER: "planner",
  PLANNER_WORKER: "planner-worker",
  CODER: "coder",
  CODER_WORKER: "coder-worker",
} as const;
export type AgentRole = (typeof AGENT_ROLE)[keyof typeof AGENT_ROLE];

export interface RoleProfile {
  readonly role: AgentRole;
  /** Fixed on Luke's key (planner), the agent row with BYOK (coder), or the recorded delegation (workers). */
  readonly model: ModelPolicy;
  readonly instructions: InstructionsPolicy; // session prompt, optional per-turn standing context, optional seed
  readonly delegation: DelegationMode | undefined; // BACKGROUND (planner) | BLOCKING (coder) | none (workers)
  readonly connections: ConnectionPolicy; // ALWAYS_ON | AGENT_SWITCHES, admitted as root or delegated
  readonly sandbox: SandboxPolicy; // READ_SHALLOW_LAZY | WRITE_FULL_EAGER | PARENT, stopAtTurnEnd
  readonly skills: boolean;
  readonly titled: boolean;
}

export const ROLE_PROFILE: { readonly [R in AgentRole]: RoleProfile } = { ... };
```

- **Attendance** is deliberately not in the profile (§2). A tool that needs
  the developer asks the runtime at call time whether anyone is present.
- **Tools** are not in the profile either. Each tool declares its own roles
  (§3.2), so adding a tool touches one table.

### 3.2 One tool registry

`agent-runtime/tools.ts` holds one table. Each entry carries a name, its roles,
its model-facing declaration, its stored input schema, and either a hosted
runner or the eve built-in it re-exports.

```ts
{ name: "search_web", roles: [PLANNER, PLANNER_WORKER, CODER, CODER_WORKER], ... }
{ name: "run_in_repository", roles: [PLANNER, PLANNER_WORKER], ... }
{ name: "bash", roles: [CODER, CODER_WORKER], eve: bashStartingIn(CODER.CHECKOUT_PATH) }
{ name: "show_code", roles: [PLANNER], ... }
{ name: "edit_plan", roles: [CODER], ... }
{ name: "start_coding_agent", roles: [PLANNER], ... }
```

Everything that is two today derives from this table:

| Derived from the table | Replaces |
| --- | --- |
| The stored tool set per role | `HOSTED_TOOL_SET` and `CODER_TOOL_SET` |
| A worker's allow-list | Both `WORKER_TOOL_NAMES` |
| The planner's dynamic resolver | `hostedTools()` filtering by `offered` |
| A guard test that each root's static `tools/` files equal its role's static entries | Nothing guards this today |

Static vs dynamic tools follow an eve rule. Workflow tools must be static files
under `tools/` ("not tools returned from `defineDynamic` resolvers",
`eve/docs/tools/workflows.mdx`). So `delegate`, and the Mac command tool if it
parks on approval, stay one-line static files in each root that needs them.
Everything else may come from one dynamic resolver per node, filtered by role.

### 3.3 One connection set

`agent-runtime/connections.ts` exports
`integrationConnections(role): defineDynamic(...)`. It returns a map
`{linear, notion, sentry, slack}` built from `INTEGRATION` on `turn.started`.

- **Names stay the same.** eve names a map entry by its bare key, so tool
  rows such as `connection_search`, `connection_execute` and
  `linear_remote` are unchanged (`eve/docs/guides/dynamic-capabilities.md`,
  §naming).
- **Admission comes from the role.** Root roles use `host.admit`; worker roles
  use `host.admitDelegated`.
- **Switching comes from the role's connection policy.** The coder honors
  `disabled_servers`; the planner is always on, for now.
- **`instanceKey` is the account,** which eve requires for an authenticated
  dynamic connection (`servers.ts:96` already sets it).
- **File count.** Each agent node keeps one file, `connections/integrations.ts`:
  4 files instead of 16. A new provider is one `INTEGRATION` entry and no new
  files.

### 3.4 One host

`AgentHost` replaces `BrainHost` and `CoderHost`. It is built from one seam set,
and its role-specific methods sit behind the profile:

- `prompt` and `standingContext`
- `model`, including metering
- `checkOut`
- `recordBranch`
- `seed`
- `title`

The shared core stays as it is: admit, relay, relayChild, runTool, admission
standings and the eve-session client.

The two `host.ts` edges become one shared edge module that each root re-exports.
It holds the doors: `relayChildEvent`, `integrationConnections`, `makeDelegation`,
`runHostedTool`, `sessionSkills`.

### 3.5 One sandbox lifecycle

There is one prepared image, the coder's: the code tooling, pnpm and python.
Every session starts from its snapshot, so the larger image costs no time at
session open. There is one selector, branching on the role's `SandboxPolicy`:

| Policy | What it does | Who |
| --- | --- | --- |
| `READ_SHALLOW_LAZY` | Read token, depth 1, cloned on first use | Planner |
| `WRITE_FULL_EAGER` | Write token, full clone, firewall credential | Coder |
| `PARENT` | `defineParentSandbox()` | Workers |

The store hook's sandbox half moves into the runtime and applies to every
role: stop at each turn's end, renew the credential when it ages. The planner
gains stop-at-turn-end. Today a planning sandbox runs until Vercel idles it, so
this saves money. A stopped sandbox resumes from its snapshot with the checkout
intact (`eve/sandbox.ts` header).

### 3.6 One subagent mechanism

Decided differently (§8, Decision 3): the one `delegate` takes a `background`
flag for every role, the coder defaulting to foreground and the planner
offered background alone. The rest of this section stands.

There is one hidden `worker` per root (`tool: false`), reached through one
`delegate` workflow tool whose implementation is shared:

- **Inputs:** `{ task, model?, effort? }`.
- **Before the child starts:** the delegation is recorded, with model and
  effort, in a step, as `coder/tools/delegate.ts` does today.
- **Planner:** the root's file uses `task`, so the call returns a receipt and
  the voice is never held.
- **Coder:** the root's file uses `execute` and blocks, as decided today.
  - Making the coder background too is Decision 3.
- **What disappears:** `worker`/`task_wait`/`task_cancel` as planning row
  kinds, the planner's `EVE_DELEGATION_INPUT`, the relay's two subagent
  shapes, and one of each desktop subagent adapter.
- **What the planner's worker gains:** a recorded model row (#2132 and #2244
  already show it), and a model choice later if wanted.
- **The record:** `coding_agent_delegation` generalizes to a `delegation`
  table keyed by child conversation.

The worker's resolvers get no lineage (`DynamicResolveContext.session` has no
`parent`). That is already solved: the worker's hook pins `parentCallId` into
state (`coder/subagents/worker/hooks/store.ts`), and the role comes from the
session's auth attributes, which a child inherits because a child runs as its
caller's principal (`eve/docs/subagents/index.mdx`).

### 3.7 One transcript schema and one transcript component

As built: the planner's turns are drawn by the agent tab's own component
(#2365). The Transcript and Work tabs became one Call tab, whose spoken
lines are drawn as messages too, so the deviation from the proposal below
is that a planner's user lines are drawn, as the voice transcript. The Call
tab draws each turn's work under the line that asked for it. Every tool name
lives in one shared vocabulary (`@sidecar/features/agent-tools`, #2397), and
the agent tab reads the planning model's raw calls by it. The wire switch
(9b) and the old wire's deletion (9c) come after the release, as one step:
9c has to wait for a desktop release anyway, and 9b alone would double the
live frame for no visible change.

**Wire.**
- **One route for every conversation:** the coder's held long-poll page
  (`coder-host/transcript.ts` `transcriptPast`) over raw stored parts,
  generalized to any conversation the account owns, child conversations
  included.
- **The planner's conversation is read through it.** The Work tab stops
  reading `planWorkOf`'s projection. The `plan.work` socket frame becomes
  unnecessary, because a held read hears a new part within one poll
  (`CODER.MESSAGES_POLL`, 500 ms).
- **The projection and its own vocabulary go:** `planWorkOf`,
  `PLAN_WORK_TOOL` and `PLAN_WORK_STATE`.
- **Kept for older desktops:** the old route and frame, until the desktop's
  minimum version passes the switch (§7).

**Component.**
- **The Work tab becomes the planner's agent tab:** `AgentTranscriptView` over
  the plan's conversation, with:
  - no composer (a planning turn is spoken);
  - the turn's checkpoints;
  - `start_coding_agent` drawn as the opening call it is today.
- **One part model, fold reading, tool-kind map, part dispatcher, subagent
  row, subagent tab and paging path.** Every pair in §1.2's desktop row
  collapses.
- **What stays per role is presentation:** a planner turn has no user bubble,
  because its user line is the voice transcript (`RECEIVED_LINE`,
  `brain-host/bounds.ts:128-133`).

### 3.8 Models, keys, metering, instructions

- **Model policy is per role.** Planner: fixed default on Luke's key. Coder:
  the row's choice, BYOK first. Workers: the delegation record.
- **Metering is one rule:** every inference on **Luke's** key is metered. The
  coder's Luke-key steps start counting; BYOK steps never do. Every turn is
  priced for display, the planner's included.
- **Instructions stay four prompts,** because each prompt is a role's identity
  and that is legitimate configuration. They are composed from one library
  of shared fragments: command descriptions, the private-repository rule, the
  integrations sentence, and skill use.
- **The scripted fixture models** share one skeleton, each with its role's
  script.

### 3.9 One eve root, or two thin roots?

eve allows one agent per root (`eve/docs/concepts/project-structure.mdx`).
Two shapes reach "same infrastructure":

| | **A. Two thin roots over one runtime** (recommended now) | **B. One root, role per session** |
| --- | --- | --- |
| eve files | Each slot in each node is a 1–3 line re-export of the runtime | One set of files. Resolvers branch on the role read from `ctx.session.auth` |
| Static per-node fields (`compaction`, `limits`, `defaultTools`, `tool`) | Per role | Shared: one compaction threshold for both |
| Workflow tools (static only) | Each root carries only its own | Every static workflow tool is offered to every role. Whether a dynamic `null` can hide a static tool is undocumented |
| Channel | Two, already sharing `ownedAuth` | One. Presence must become per turn kind; upload policy applies to both |
| Sandbox | One image and selector, imported twice | One `environment`, one selector |
| Deploy blast radius | A coder change can't break a live call | One bad deploy breaks voice and coding together |
| Voice cold start | The planner's module graph excludes the code extension | The planner loads the coder's graph |
| Migration | Nothing moves between eve projects | Every live coder session lives in the `coder` project's workflow world, with no timeout. Merging orphans them unless coders first gain the planner's rotate-and-seed path |

**Recommendation: A now. B only once the conditions below hold and B still
buys something,** for example one deployment to operate.

The conditions:
- the runtime is shared;
- coder sessions rotate and seed as planning sessions do (worth doing anyway,
  §5 PR 10);
- the Workflow world can host both.

With A, eve still requires one file per slot per node, but each file is one
line, so "same infrastructure" holds where it matters: one table, one host, one
lifecycle.

## 4. What stays genuinely separate, and why

- **The live voice layer.** It includes:
  - GPT Live and its session;
  - delegation into asks (`brain-ask.ts`);
  - following the journal every 250 ms;
  - sentence release;
  - the detach/attach grace;
  - `voice_sessions`.

  It is a front end that opens planner turns. It is not an agent, and it has
  its own model, key and latency loop. Making it a role would put eve's
  durable loop under real-time audio.
- **The notetaker** (`voice/plan-scribe.ts`). It is a small model reacting to
  the call's ledger, inside the voice service, between utterances. Its write
  path (`saveNotes`) is already shared with the coder's `edit_plan`, which is
  the part that should be shared.
- **Journal-carried tools** (`queue_question`, `withdraw_question`,
  `end_call`). They mean something only to a voice that reads the journal mid
  turn. They stay planner-only entries in the registry.
- **The plan's tab chrome.** The planner's agent tab has no composer, model
  chip or MCP popover until the product wants them. That is per-role
  presentation, not a second component.

## 5. Migration path

As built (2026-10-13):

| PR | | |
| --- | --- | --- |
| 1 | One connection set | #2363 |
| 2 | One tool registry with roles | #2386 |
| 3 | One transcript part view | #2365 |
| 4 | One web-research pair | #2372 |
| 5a | Worker rows read their own session | #2387 |
| 5b | One delegation, a resumable task (`serve`) in both roots: the coder waits with `task_wait` unless it sets `background`, and the planner always runs in the background | #2402 |
| 6 | One meter | #2367 |
| 7a | One edge kit | #2401 |
| 7b | One host core (admission, session claim, a worker's child). The rest of each host is its role's own, so the hosts stay two over the core | #2405 |
| 8 | One sandbox lifecycle | #2403 |
| 9a | One tool-name vocabulary | #2397 |
| 9b, 9c | One transcript wire, then deleting the old wire | #2411, #2419 |
| 10 | Coders rotate and seed | deferred with the one-root goal: a live coder session is only retired by a deletion, and a new session would lose its sandbox's uncommitted work |
| Decision 4 | Brain skills | #2375 |

Each PR keeps both live paths working, ships its own tests, and passes
`check.sh`. Sizes are rough diff size: S is under 200 lines, M is 200–600, L
is over 600.

| # | PR | Size | Notes |
| --- | --- | --- | --- |
| 1 | **One connection set.** `agent-runtime/connections.ts` builds `{linear, notion, sentry, slack}` as one dynamic map per role. The 16 connection files become 4 `connections/integrations.ts`. The planner's connections resolve per turn. | S | Rewrite `integration-agents.test.ts` to resolve each node's map and hold every `INTEGRATION` provider on all four nodes under its own admission. It fails today for a provider added without files. Conflicts only with `coder/host.ts` edits in the rollout PRs. |
| 2 | **One tool registry with roles.** `agent-runtime/tools.ts`, deriving both stored sets, both worker allow-lists and the planner's resolver filter. Adds a guard test that each root's static `tools/` files equal its role's static entries. No tool changes behavior. | M | Land after, or rebase onto, rollout #2265/#2270/#2277, which add `report` and `read_plan` to `tool-set.ts`. Those become `roles: [CODER]` entries. |
| 3 | **One transcript part view (desktop).** The Work tab and the agent tab render through one part model, part dispatcher, tool-call adapter, subagent row and subagent tab. Both wires stay, each adapted into the one part model at its edge. | M (net negative) | Touches files that #2257 (company brain) and #2249 (rollout) touch. |
| 4 | **One web-research pair.** Every role uses `search_web` and `read_web_page` (screened, cited, budgeted). The coder's eve `web_search`/`web_fetch` files go. | S | Decision 2. Luke's key pays for coders' searches, metered by PR 6. |
| 5 | **One delegation.** One `delegate` workflow implementation and one hidden `worker` per root. The planner's root uses `task`; the coder's uses `execute`. The planner's visible worker and its `task_*` row kinds retire. `coding_agent_delegation` becomes `delegation`. | L (2 PRs: server, then desktop) | The Work tab's Stop names a subagent by task id (#2130), so keep `task_cancel` working until the desktop switches. Store tests on Postgres for the table move. |
| 6 | **One model and metering policy.** `ModelPolicy` per role. The meter counts every Luke-key inference, coders included, and every turn is priced. | S | Count-only meter (`brain-host/model.ts:10-21`), so no new refusals. |
| 7 | **One edge kit and host.** Shared relay hook, child-relay hook, prompt resolver and model resolver. `AgentHost` replaces `BrainHost`/`CoderHost`. Both `host.ts` edges become re-exports. | L (3 PRs: hooks and instructions, host merge, seams merge) | `effect-edges.json`'s `runtimeEdges` stays valid if the authored files remain the edges. Keep both evals green at each step. |
| 8 | **One sandbox lifecycle.** One image and selector with `SandboxPolicy`. The planner's sandbox stops at turn end. Credential renewal moves into the runtime. | M | Watch first-call latency: a stopped planning sandbox resumes on the next `run_in_repository`. |
| 9 | **One transcript wire.** A generic held conversation read. The Work tab switches to it. `planWorkOf`, `PLAN_WORK_TOOL` and the `plan.work` frame are deleted once the desktop's minimum version passes. | L (server PR, desktop PR, later deletion PR) | The desktop's session replay masking is unchanged (rows are words). The voice keeps `projectTurnEvents`, which `plan.work` never fed. |
| 10 | **Coders rotate and seed.** A coder session answered `RETIRED` reopens and is seeded from the store, as planning sessions are. | M | Precondition for any later root merge, and a resilience win on its own. |
| 11 | *(Optional)* **One root.** Merge `apps/web/coder` into one eve project with role-per-session resolvers. Retire the `coder` service once its live sessions have rotated. | L | Only after 1–10, and if Decision 1 picks B. |

PRs 1, 2, 4 and 6 are independent of each other. PR 3 is desktop-only and can
run in parallel with them. PR 7 goes better after PRs 1, 2 and 6. PR 9 follows
PR 3.

## 6. How the in-flight features land

- **Mac command tool.** Decided (§8, Decision 5): it reaches the Mac over
  the account-wide channel as #2359's `run_on_mac` does, with no approvals,
  and becomes a registry entry. The proposal's text follows.
- **Mac command tool, as proposed** (`docs/proposals/mac-commands.md` on
  `conductor/local-mac-command-tool-design`). The design recommends the brain
  alone; the orchestrator says it is being built for both roots. On the
  runtime:
  - **One registry entry**, `roles: [PLANNER, CODER]`.
  - **One implementation module.** Because it parks on approval, it is a
    workflow tool and so a static one-line file in each root (eve rule,
    §3.2).
  - **The one real difference is attendance, which is a runtime fact.** A
    planner turn always has a call, so the card above the call bar works. A
    coder may run with nobody watching.
  - **Recommendation to that workspace: deliver approval requests over the
    account-wide held inbox read** (`accountInboxPast`,
    `coder-host/inbox-page.ts`, held for the whole sign-in), not only the
    call socket. A coder's request then parks durably as an inbox item until
    answered, and the planner's request reaches the same Mac with or without
    a call. One approval channel serves both roles.
- **Interactive pages** (design at the "Interactive HTML pages (design)"
  workspace's `.context/pages-design.md`, paused).
  - **One `show_page` entry**, `roles: [PLANNER, CODER]`, input
    `{title, html} | {title, path}`.
  - **No workflow tool needed,** so it comes from the dynamic resolver for
    both.
  - **Storage, the `luke-page:` frame and the Page tab are role-agnostic**
    already. That workspace has said the unification only merges its PRs 2
    and 5.
  - **The transcript row is written once** after PR 3.
- **MCP for the brain.** The brain already has all four integrations (static,
  always on). After PR 1 its connections resolve per turn, so honoring a
  switch is a one-word policy change (`ALWAYS_ON` → `AGENT_SWITCHES`). Where
  the planner's switch lives (the plan's ⋯ menu, or Settings › Integrations
  per plan) is a product call (Decision 4).
- **Skills for the brain.** Today it has none. On the runtime, it gains
  `skills: true` in the planner profile and `load_skill` in the planner's
  allow-list.
  - **The cost:** a GitHub read of `.agents/skills/` at session start, on the
    call's first turn.
  - **Mitigation:** read it during `explore()` at call start
    (`voice/live-brain.ts:765-775`), which already warms the session.
  - Decision 4.
- **The rollout series (#2227–#2277, open).** It adds a `report` turn kind, a
  coder `report` tool, `read_plan`, and the planner orchestrating coders.
  - It edits `coder/host.ts`, `tool-set.ts`, both channel turn tables,
    `planning.ts` and `plan-work`. Land PR 2 and later after it, and treat
    its tools as registry entries.
  - It strengthens the case: the coder now talks back to the planner as a
    turn on the plan's conversation, the same store and wire the unified
    transcript reads.
- **Company brain (#2257, open).** Its `remember`/`recall` become registry
  entries with `roles: [PLANNER]`. Giving coders the account's memory is then
  a one-line role change, not a second implementation.

## 7. Risks

- **eve constraints.**
  - Names come from filenames per node, and a declared subagent inherits
    nothing (`eve/docs/subagents/index.mdx`, isolation table). Each node keeps
    its own files. Map-returning dynamic files keep that to one file per slot
    for connections, tools and skills.
  - Workflow tools must be static, so in a shared root (shape B) they cannot
    be role-gated. Shape A avoids this.
  - Resolvers get no lineage, so the role must come from session auth
    attributes. Children inherit their caller's principal. PR 1's test
    should confirm a worker's admission reads the role.
  - Dynamic subagents can return `null` per role (`dynamic-capabilities.md`,
    "Dynamic subagents"), which shape B needs.
  - `compaction`, `limits`, `defaultTools` and `tool` are static per node.
- **Voice latency.**
  - The planner's tool list must stay short and stable for the prompt-cache
    prefix. The registry's role filter keeps it so.
  - Stop-at-turn-end (PR 8) makes the first repository read of a call resume
    a sandbox. Measure it.
  - Shape B would load the coder's module graph in the planner's function.
  - The brain eval should record time to first token before and after PRs 7
    and 8.
- **Cost.**
  - Searches by coders on Luke's key (PR 4).
  - Coder inferences start counting on the daily meter (PR 6; it counts, it
    doesn't refuse).
  - The planner's sandbox stopping at turn end saves money.
  - One prepared image adds build time once per deploy, not per session.
- **Version skew.** The web service serves desktops older than the newest
  release. PR 9 keeps `/api/plans/{id}/work` and the `plan.work` frame until
  the minimum supported desktop reads the generic route.
- **Privacy.**
  - PR 9 sends the planner's raw stored parts to the desktop instead of a
    4,000-character projection. They pass through the same act and Gateway
    path the agent tab already uses and fall under the same
    no-credentials rule as every coder transcript today.
  - The 4 k bound was a frame size bound, not a privacy line, but the PR
    should say so in its body.
- **Concurrent work.** 15 rollout PRs, company brain, Mac commands and pages
  are all in flight across these files. The order in §5 starts where they
  don't overlap (PR 1, PR 3, PR 6).
- **Blast radius of a shared runtime.** One bug in `agent-runtime/` reaches
  both agents even with two deployments. Both offline evals run in CI's `test:agent`
  job (`.github/workflows/ci.yml:117`) on every PR, and they must stay green
  at every step.

## 8. Decisions (Dean, 2026-10-13)

1. **Two thin eve roots now, on one shared runtime.** One root stays a later
   goal (§3.9).
2. **The hosted `search_web` and `read_web_page` for every role,** on Luke's
   key and metered.
3. **Changed from the proposal: one delegation mechanism with both
   foreground and background subagents for every role,** as other agents
   have. The caller either waits for the worker's answer (foreground) or
   carries on and hears it later (background). The model chooses per call
   through a `background` flag whose default comes from the role.
   - **The coder gets both,** defaulting to foreground, as it delegates today.
   - **The planner gets background only.** A foreground call would hold the
     spoken turn silent for the worker's whole run, and the voice already
     follows a turn parked on a background task (`PARKED_FOLLOW`,
     `voice/live-brain.ts`). Offering the planner no flag at all is the
     simplest way to keep the voice fast: it is one fewer choice for the
     model to get wrong mid-call.
4. **Brain skills now** (the profile flag plus `load_skill`, read during
   `explore()`). **Per-plan MCP switches later.**
5. **The Mac tool reaches the Mac over the account-wide channel,** as #2359's
   `run_on_mac` already does, **with no approvals.** It becomes a registry
   entry.
6. **Meter every inference on Luke's key, coders included.**
