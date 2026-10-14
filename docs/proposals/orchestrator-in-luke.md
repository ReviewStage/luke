# Proposal: Dean's orchestrator workflow, in Luke

Status: planning only, written 2026-10-14. Nothing here is built until Dean
answers the decisions in §8.

- **Revision 3, against main at `e34497e3`:** rebuilt on Charles's **Chat**
  (#2569, #2571, #2576, #2579, #2580, #2582, #2584, and the `chat/*`
  branches) and on his rollout and stack work (#2227–#2277, #2377–#2391).
  The parallel Inbox and decision system of revision 1 is gone.
- **Revision 2:** agents and conversations may now have no plan (worker 259).
- **Conflicts to raise with Dean and Charles** are collected in §7.

The design show is served from the planning workspace at
https://stage-w2169.conductor.show/ for as long as that workspace stands. It
shows the orchestrator DM, a decision in For you, a batch, and these
decisions as a form.

Dean's ask: "I want to have a way to do what I've been doing in this
Conductor chat but in Luke. It's getting hard to keep up with all of the open
decisions and I just want to use the Inbox for that. What functionality are
we missing for me to migrate my workflow to Luke? Let's plan that out."

## TL;DR

- **Chat replaces the Inbox, and covers most of what Dean asked for.**
  - A workspace has `#general`, a channel per plan, topic channels and DMs.
  - Members are people, coding agents (`@agent-N`) and a per-plan planner
    (`@luke`).
  - Agents talk through `post_chat`, `read_chat` and `resolve_ask`.
  - An **ask** is the Inbox's choice, form, text, approval, task or notice,
    lifted unchanged:
    - options, a recommendation and a note;
    - re-posting under the same key updates it, with a revision check;
    - answered as a reply in its thread;
    - resolved, or withdrawn, by its poster.
  - **For you** lists open asks, unread DMs and mentions.
  - A mention steers the named agent into its turn (the notice door, up to 3
    per post).
  - X1 (#2580, held until a desktop release reads Chat) deletes the Inbox's
    tables, routes, tools and window.
- **So decisions belong in Chat, not in a new Inbox system.** Every Inbox
  change in revision 1 either already exists in Chat or moves into Chat's
  vocabulary:
  - the asker table;
  - the batch route and batch view;
  - picking the recommended option up front;
  - page and PR blocks.
- **The rollout and stack series cover agent → Luke and typed lines.**
  - Builders and a stack keeper report milestones and questions to Luke
    (#2265, #2269).
  - GitHub reports merges and reviews to Luke (#2389).
  - There is a typed line to Luke (#2381, #2385).
  - Correction to the heads-up: **none of #2227–#2391 has merged.** All are
    open (checked 2026-10-14), and #2257 is Company brain, not rollout.
- **Still missing for Dean's workflow:**
  1. **An orchestrator Luke not tied to one plan.** In Chat every `@luke` is
     one plan's planner.
  2. **Answering many asks at once**, with the recommendation picked up
     front.
  3. **Page and PR blocks** in an ask.
  4. **The worker lifecycle:** wake-ups on CI, review and merge-queue
     events; the merge queue; archive on merge; stop and archive tools for
     Luke.
  5. **Spend and spawn caps.**
  6. **A tracker across plans.**
  7. **Standing instructions.**
- **Phase 1 changes:** it becomes **"Answer all" and page/PR blocks on
  Chat**: 4 PRs, about 1,700 lines. It starts once Chat's store, tools and
  live read (S, T, D4) land.
  - Revision 1's Inbox asker, batch route and Inbox blocks are dropped. X1
    deletes those tables.
  - The Conductor bridge, if kept, becomes Chat's first **bot member**, which
    runs into Dean's "bots later" (conflict C6).

## 1. Dean's loop against main and Chat

"Chat" means the open `chat/*` PRs and branches. "Rollout" means
#2227–#2277 and "stack" means #2377–#2391; all are open.

| # | Step today (Conductor) | Main | Chat, rollout, stack (open) | Still missing |
| --- | --- | --- | --- | --- |
| 1 | **Ask**: typed, often several at once and mid-turn | Voice only. `STEER` turn policy joins a follow-up to the running turn | Typed line to a plan's Luke (#2381/#2385). Chat's composer posts to `#plan` or a DM with `@luke` | One path, not two (C3). An orchestrator Luke not tied to one plan (C1) |
| 2 | **Brief + spawn** with model and effort | `start_coding_agent {task, model, effort}` on the current plan | A start takes a base, role and position (#2245, #2267). A builder gets a per-PR brief (#2259) | Starts across plans, and with no plan (worker 259). `contextWindow` |
| 3 | **Run long**: CI, Devin, merge queue, rebases | Many turns with snapshot resume. CI is watched inside a turn only | The keeper restacks and merges on Luke's word (#2277). A chat mention steers an agent | Wake-ups on GitHub events, a merge-queue tool, waiting on a PR, a long idle |
| 4 | **Report back** | Nothing reaches Luke; he must read | Report turns to Luke (#2249, #2265, #2269). GitHub reports (#2389). Agents post milestones in their plan channel | One report path, not two (C4). Reports from non-rollout agents |
| 5 | **Verify, track, archive** | `read_coding_agent`; archive is a desktop route | `[rollout]` state in Luke's context (#2255). Last report on the row (#2379). Stack tab (#2384, #2391). Chat's roster | A tracker across plans; stop and archive tools for Luke; archive on merge |
| 6 | **Relay, answer "why", steer** | Code and web reading, cited; `message_coding_agent` | The keeper and builders take Luke's word. Mentions steer agents | Reaching across plans; a stop tool |
| 7 | **Decisions** | The Inbox | Chat asks plus For you (D1, D2). The Inbox goes (X1, D7) | Answer all / accept recommendations, the recommended option picked up front, page and PR blocks; who may answer (C5) |
| 8 | **Standing preferences** | None | Company brain #2257 (draft, conflicting) | Standing instructions |
| 9 | **Dean's Mac** | `run_on_mac` | (none) | Nothing |
| 10 | **External systems** | Integrations for both roles | (none) | A merge-queue wrapper |

### 1.1 What Chat gives Dean's workflow outright

- **Decisions with a recommendation and a note,** kept current under a key
  and withdrawn with a reason. This is revision 1's decision card, already
  designed and drawn: D2's `chat-ask.tsx` is built from the Inbox's answer
  pieces.
- **One list of what waits on Dean:** For you, ordered oldest first. That
  replaces "every reply restates every open decision".
- **A record of each topic:** a plan channel where its agents post
  milestones ("merged #2553", "round 3 is up"). Dean reads the channel
  instead of the orchestrator's relay.
- **Agents talking to each other** ("@agent-2 wait for #214") and to Luke
  (`@luke` in a plan channel). The orchestrator relays much of this by hand
  today.
- **Answers that route back.** An answer is a thread reply, and a
  `needsReply` ask steers its poster's turn through the notice door (M1's
  chat metadata, D3's notice card).
- **Typing to Luke and to agents** from the composer, with `@` and `#`
  completion.

### 1.2 What Chat does not give it

- **An orchestrator.** `MEMBER_KIND.PLANNER` is "a plan's Luke, one per plan,
  always `@luke`". `chat_member` keys a planner by `plan_id`, and `@luke`
  resolves to the planner of the channel's plan or the author's plan.
  - Nothing answers `@luke` in `#general`, a topic channel, or a DM that
    belongs to no plan.
  - Nothing lets one Luke start or steer agents in several plans.
- **Batch answers.** For you answers one card at a time. A recommended
  option is labelled but not picked, so every answer takes a press.
- **Pages and PRs in an ask.** Chat's blocks are the Inbox's: Markdown, a
  link, code and an image.
- **The worker lifecycle, caps and a tracker.** These are outside Chat's
  scope, and still missing.
- **Outside askers.** Chat's members are people, agents and planners. There
  is no member for an agent that runs outside Luke, such as this Conductor
  orchestrator.

## 2. The shape, on Chat

### 2.1 Where Dean types: a DM with the orchestrator Luke

The orchestrator is **a planner member with no plan**: one per person per
workspace, reached as a DM at the top of Chat's rail (Decision 1).

- Dean's asks, Luke's tool rows, Luke's digests and Dean's "why" questions
  all live in that DM.
- Behind the DM, Luke's turns run on a planning conversation that no plan
  references. That is the planner-side twin of worker 259's planless agent.
- Its tool calls bind `planId: null`. Each plan-bound tool says what it does
  without a plan:
  - the board tools refuse;
  - `show_code` and `run_in_repository` need a named repository;
  - `show_page` follows worker 259's answer for planless pages.

Two things in Chat stand against this, and both are for Charles (C1, C2):
- every planner is `@luke` and is told apart by its plan;
- every person in a workspace reads every DM.

A Luke sidebar row beside Chat (revision 1's design) remains the fallback,
if a planless planner member does not fit Chat's model.

### 2.2 How Luke briefs and starts agents

- **The coding-agent tools take an optional `planId`.**
  - No plan means a planless agent, with a `repository`, on worker 259's
    rework.
  - A topic that has a plan keeps its channel, its Stack tab and its
    rollout.
  - Luke never makes a plan just to hold an agent.
- **A rollout stays the rollout series' design:** one builder per PR, one
  stack keeper, `[rollout]` state, and Luke offering Ready to merge. The
  orchestrator starts a rollout in a plan by telling that plan's Luke, or by
  doing it directly with the plan's `planId`. Decision 5 limits who starts
  what.
- **Luke gains `stop_coding_agent` and `archive_coding_agent`.**
- **Starts count against a live-agent cap and a daily spend cap**
  (Decision 6).

### 2.3 How reports arrive

There should be one path. Today the open work has two (C4):
- the rollout's `report` tool, which opens a **turn on the plan's
  conversation** (#2249, #2265, #2269);
- an agent's **`post_chat` in its plan channel**.

This proposal recommends that a report be a chat post:
- The report kinds (`pr_opened`, `ci_green`, `blocked`, `question`,
  `merged`, `finished`, `failed`, …) become structured blocks of a post in
  the plan channel. It mentions `@luke` when Luke must act.
- A planner woken by a mention gets #2249's report turn, so the rollout's
  standing context and instructions keep working.
- GitHub's reports (#2389) post into the same channel, as a system line or a
  GitHub member.
- The orchestrator reads plan channels and posts a digest in Dean's DM. A
  planless agent posts where worker 259 and Chat settle a planless agent's
  default channel (C7).

### 2.4 Decisions: an ask in Chat

Revision 1's decision card *is* Chat's ask card, and nothing about it is
redesigned here. Phase 1 adds three things on top of D2:

- **The recommended option picked up front** (Decision 4). Send alone
  accepts it, and the card says what Send will do.
- **Page and PR blocks** in `chat-wire.ts`:
  - a `page` block opens a `show_page` page in the side panel;
  - a `pull` block names a PR and draws its live state.

  The Inbox names alias Chat's until X1 deletes them, so only Chat's
  vocabulary changes.
- **Ask Luke:** from any ask, post the question to the orchestrator DM,
  quoted, without answering it.

### 2.5 Answer all

- **Where it shows:** For you groups its open asks by channel. A channel
  with two or more open asks shows **Answer all**, and so does the channel's
  own header.
- **What it opens:** every open choice in that channel as one form. Each
  question starts on its recommendation and has an optional note.
- **The button:** reads **Accept 7 recommendations** until Dean changes
  one, then **Send 7 answers · 1 changed**.
- **The request:** one request, one answer per ask, each naming its
  revision. An ask its poster changed in the meantime is refused alone and
  comes back marked, while the rest go. Each answer lands as its own thread
  reply, so it routes exactly as a single answer does.
- **Approvals, forms and tasks** stay one at a time.

### 2.6 How a decision travels, on Chat

1. **Ask.** An agent or a planner posts an ask under a key, in its channel
   or a DM. Re-posting under the key updates it at a bumped revision.
2. **Wait.** For you counts it, and the sidebar's Chat row badges.
3. **Answer.** Dean answers one ask, or a channel's batch (§2.5). Each
   answer names its revision.
4. **Route.** The answer becomes a thread reply. A `needsReply` ask steers
   its poster through the notice door. A planner poster is woken as in §2.3.
5. **Continue.** The poster reads the pick and the note verbatim and goes
   on.
6. **Settle.** The poster's next post says what it did. The orchestrator
   updates the tracker and archives the agent once its PRs are verified
   merged.

### 2.7 The Conductor bridge, if kept: Chat's first bot member

Dean's workers are Conductor workspaces until phase 2. To get their
decisions into For you before then, the Conductor orchestrator would need
to be a Chat member that is neither a person, an agent nor a planner:
- a **bot** member, with a scoped token minted in Settings and stored as a
  hash;
- allowed to post asks in a topic channel, resolve them, and read their
  answers, and nothing else.

That is a fourth `MEMBER_KIND`, and Dean has said bots come later
(conflict C6). The alternative is no bridge: decisions reach For you once
the workers move into Luke in phase 2 (Decision 2).

### 2.8 Built on worker 259 and on Chat

| Piece | Who owns it | What this plan takes | What this plan adds |
| --- | --- | --- | --- |
| **Planless agents** (`coding_agent.plan_id` nullable, the no-plan brief, the repository) | Worker 259 | 2.2's planless starts | Nothing |
| **Where a planless agent appears and posts** | Worker 259 + Chat: its default channel when there is no plan channel (C7) | Planless reports | Nothing |
| **Planless pages** (`show_page` keys pages by plan) | Worker 259 | Design rounds from planless agents | Nothing; this plan depends on the answer |
| **Members, channels, DMs, threads, mentions, notices** | Chat (S2a, S2b, S3c, D1, D3) | Everything | A planless planner member (C1) |
| **Asks and their cards** | Chat (S1, D2) | Decisions | Recommended picked up front, page and PR blocks, Answer all |
| **For you** | Chat (D1) | The list of what waits | Grouping by channel for Answer all |
| **Reports, report turns, `[rollout]` state** | Rollout series | 2.3 | Reports as chat posts (C4), and from every agent |
| **Typed line to Luke** | Stack B1/B2 | The DM's door into the planner | One path with Chat's composer (C3) |
| **The planner with no plan** | This plan | (n/a) | `planId: null` bindings, offered to worker 259's coder side |

**Worker 259's "Inbox breadcrumbs" work targets a surface X1 and D7
delete** (C7). It should target Chat instead: the default channel of a
planless agent, and how its asks show in For you.

## 3. Phasing

Sizes are rough diff sizes: S under 200 lines, M 200–600, L over 600.
Desktop PRs need `verify.sh` evidence, which the workers run themselves.

### Phase 1: Answer all, on Chat (4 PRs, about 1,700 lines, plus the bridge if kept)

The goal is that Dean answers every decision in For you, many at once.

It waits on Chat's store chain S (through the ask store), its tool chain T
(`post_chat` with asks), and D4 (the live read). Dean's relief therefore
lands with Chat, not before it (C8).

| # | PR | Size | Depends on |
| --- | --- | --- | --- |
| 1.1 | **Recommended picked up front** on D2's ask card, and the Send hint | S | D2 (#2582) |
| 1.2 | **Page and PR blocks** in `chat-wire.ts` (the block vocabulary moves on; goldens re-recorded), drawn in the card | M | S1 (#2571), D2 |
| 1.3 | **Batch answers:** the chat answer route takes up to 25 `{askKey or message, revision, reply, clientKey}`, with an outcome per ask, each landing as its own thread reply | M | Chat's answer route (chain S/T) |
| 1.4 | **Answer all:** For you grouped by channel, a channel's Answer all, Accept N / Send N, and stale asks marked | L | 1.1, 1.3, D4 |
| 1.5–1.6 | *(If Decision 2 keeps the bridge.)* **A bot member** with a scoped token (Settings, hashed), posting and resolving asks in a topic channel and reading answers; plus the skill for the Conductor orchestrator | M + S | S2a's members, Decision 2, C6 |

Dropped from revision 1:
- the Inbox asker migration, because Chat's members already name a planner
  or an agent;
- the Inbox batch route and view, the Inbox page and PR blocks, and Luke
  posting to the Inbox, all because X1 deletes the Inbox. Luke posting asks
  is Chat's planner member and chain T (to confirm, C9).

### Phase 2: the orchestrator Luke (9 PRs, about 3,800 lines)

It depends on the rollout series landing, on stack B1/B2, and on Chat's
planner member.

| # | PR | Size | Depends on |
| --- | --- | --- | --- |
| 2.1 | **The planless planner:** a planning conversation no plan references, bound `planId: null`, as a Chat planner member with no plan (one per person per workspace) | M | C1, C2; worker 259's binding |
| 2.2 | **Its door:** a post in the orchestrator DM is a typed ask through #2381's `acceptAsk`, steering a running turn | S | 2.1, #2381, C3 |
| 2.3 | **Desktop:** the orchestrator DM at the top of Chat's rail, and the tracker beside it | M | 2.1, D4 |
| 2.4 | **Tools across plans, and with none:** an optional `planId` (none means planless with a `repository`), `list_plans`, and `create_plan` only on Dean's word | M | 2.1, worker 259 |
| 2.5 | **`stop_coding_agent`, `archive_coding_agent`** | S | 2.4 |
| 2.6 | **Reports as chat posts:** the rollout `report` tool posts structured blocks in the plan channel, mentioning `@luke`, and a mention wakes the planner with #2249's report turn. Widened to every agent | M | rollout #2265/#2269, C4 |
| 2.7 | **The digest:** the orchestrator reads plan channels past its cursor and posts "while you were away" in the DM, with a count of open asks (For you holds the asks) | M | 2.6 |
| 2.8 | **The tracker:** worker 259's account-wide agent read, widened with Chat's last post, the PR state and spend | M | 2.3, worker 259, stack #2379 |
| 2.9 | **Standing instructions** in Settings, read into the planner's context, and **spend and spawn caps** checked at every start | M | none |

### Phase 3: long-running workers (6 PRs, about 2,400 lines), unchanged

| # | PR | Size |
| --- | --- | --- |
| 3.1 | **GitHub wakes the agent:** failed checks, reviews, review comments and merge-queue removal on its own PR become a chat notice to the agent, keyed by delivery, beside #2389's report | M |
| 3.2 | **`enqueue_pull_request`** (GraphQL), under Decision 7's rule | M |
| 3.3 | **`wait_for {pr}`:** woken when the PR merges or closes | M |
| 3.4 | **Archive on merge**, verified on the base | S |
| 3.5 | **Several PRs per agent** (may be unneeded with one builder per PR) | M |
| 3.6 | **A long idle:** an expired snapshot is rebuilt from the pushed branch | M |

### Phase 4, sized when reached

- **Factory** on 2.8's read.
- **Live sandbox previews.**
- **Voice with the orchestrator.** This needs a voice session with no plan.
- **Company brain**, if Decision 12 picks it.
- **Bots, later, not designed here.** Dean: "let's not do dependency
  updates. We can maybe add an auto-approving/auto-merging bot once we add
  bots (like also a code review bot)."
  - **What a bot would be:** an agent with a standing role, likely planless.
    Chat already gives it a member and a voice.
  - **What starts or wakes it:** automations or GitHub events, through
    3.1's reading of a delivery.
  - **An approve-and-merge bot** would act through 3.2 under Decision 7's
    rule; a review bot would answer the events 3.1 reads.
  - **Limits:** it counts against the caps and shows in the tracker.
  - **Room phase 3 must leave:** 3.1's "skip bot-sent events" guard must
    later tell Luke's own bots apart from outside ones.
  - **The bridge:** if Decision 2 keeps it, it is the first bot member.

## 4. Overlaps with in-flight work

- **Chat** (Charles): the foundation for decisions, reports and typing to
  Luke. Phase 1 builds on S1, D2 and D4. Phase 2 needs a planless planner
  member. The conflicts are listed in §7.
- **Rollout and stack** (Charles, all open): phase 2 consumes them.
  - Reports should become chat posts (C4).
  - The typed line should be the planner's one door, which Chat's composer
    also uses (C3).
  - The Stack tab stays the per-plan view.
- **Worker 259** (automations, planless agents): 2.1, 2.4 and 2.8 build on
  it. Its "Inbox breadcrumbs" work should move to Chat (C7).
- **Automations:** a planless automation's runs are planless agents. Where
  they post is C7. Caps apply to automation starts.
- **`one-agent-runtime.md`:** every new tool is a registry entry with roles.
- **Factory** (design only): reads 2.8, so it should invent no third read.
- **@-mentions** (planned): Chat already has `@` and `#` completion in its
  composer (D2's `chat-mention.ts`). The plan-editor @-mentions and Chat's
  mentions should share one member and plan vocabulary.
- **Web/links (worker 273):** a stable link to a chat message, an ask and
  an agent (D3's "m 41" and Open in Chat) is what digests and the bridge
  point at.
- **Company brain** (#2257): Decision 12.

## 5. Risks

- **Cost and runaway spawning.**
  - There is no spend cap today, and the meter only counts.
  - Chat adds a new fan-out: a mention steers up to 3 agents per post, and
    an agent may make 20 posts a turn (`CHAT_BOUNDS`).
  - Two agents mentioning each other can wake each other in a loop. Chat's
    bounds limit each turn, not the chain of turns.
  - **Mitigation:** 2.9's caps, and a bound on mention-wakes per agent per
    hour, raised with Charles (C10).
- **Who answers.** Any member may answer an ask, at its revision. In a
  shared workspace, Charles could answer Dean's orchestrator's decisions
  (C5).
- **Privacy.**
  - Every person in a workspace reads every DM, including the orchestrator
    DM, where Dean asks "why" questions and Luke relays `run_on_mac` output
    (C2).
  - The AGENTS.md Never rule now covers chat posts: a credential must never
    enter a post, an ask or a digest.
  - The bot token, if built, is a credential: hashed, shown once, never in a
    trace, counted event or fixture.
- **The hosted runtime.**
  - A planner turn is abandoned after an hour, so the orchestrator's turns
    stay short and long work goes to agents.
  - Its conversation grows without end, so the tracker and the open asks
    must reach it from rows and Chat reads, never from what the transcript
    remembers.
- **Timing.**
  - Phase 1 now waits on Chat's chains S, T and D4, which are not yet all
    opened as PRs.
  - Phase 2 waits on the 15-PR rollout series, also open.
  - Dean's relief is gated on Charles's two largest stacks (C8).

## 6. What this does not do

- It designs no second decision system, Inbox or otherwise.
- It designs no bots, and no dependency updates.
- It answers neither the automations scope proposal nor Chat's own
  decisions. It only names where they meet this plan.
- Nothing goes into `AGENTS.md` without Dean's explicit approval.

## 7. Conflicts to raise with Dean and Charles

- **C1. The orchestrator is a planner with no plan; Chat's planner is one
  per plan.**
  - In Chat, `MEMBER_KIND.PLANNER` is "a plan's Luke". `chat_member` keys a
    planner by `plan_id` (S2a), and `@luke` resolves through the channel's
    or author's plan (S2b).
  - Dean's orchestrator needs a Luke that belongs to no plan, reached in a
    DM and in `#general` or topic channels.
  - *Ask Charles:* may a planner member have no plan, one per person per
    workspace? What does `@luke` resolve to in `#general`, a topic channel,
    or a DM with no plan?
- **C2. Every person reads every DM** (S2b, Charles's rule, and in
  `PRIVACY.md`).
  - The orchestrator DM holds Dean's "why" questions, steering, and
    `run_on_mac` output under its carve-out, all readable by every
    workspace member.
  - *Ask Dean:* is that acceptable for the orchestrator DM? If not, the
    orchestrator's DM needs to be private to its person, or it lives outside
    Chat (revision 1's Luke row).
- **C3. Two typed paths to Luke.**
  - #2381 posts a typed line to a plan's Luke through `acceptAsk`.
  - Chat's composer posts to `@luke` in a channel or DM, and Chat's PRs do
    not yet say what wakes a planner.
  - *Ask Charles:* should a chat post that mentions `@luke` be the typed ask
    (one door, #2381's), with #2385's desktop plumbing replaced by Chat's
    composer?
- **C4. Two report paths.**
  - Rollout reports open a turn on the plan's conversation (#2249, #2265,
    #2269), and GitHub reports do the same (#2389).
  - Chat has agents post milestones in their plan channel.
  - Dean would read one stream and Luke act on the other.
  - *Ask Charles:* should a report be a structured chat post mentioning
    `@luke`, waking the planner with the report turn, so Dean and Luke read
    the same record?
- **C5. Who may answer an ask.**
  - Chat: any member, at its revision. The Inbox: only its account.
  - *Ask Dean:* may a teammate answer an ask addressed to Dean (or posted by
    Dean's orchestrator), or only the person it names?
- **C6. The bridge is a bot, and Dean deferred bots.**
  - Getting Conductor's decisions into For you before phase 2 needs a
    fourth member kind with a token.
  - *Ask Dean:* build the bridge as the first, minimal bot member (Decision
    2 A), or skip it and wait for phase 2 (Decision 2 B)?
- **C7. Worker 259 plans Inbox breadcrumbs for planless agents, which X1 and
  D7 delete.**
  - *Ask worker 259 and Charles:* target Chat instead. Where does a planless
    agent post by default, with no plan channel? What does For you say of
    its asks?
- **C8. Timing.**
  - Revision 1's phase 1 could start today on the Inbox; Chat deletes the
    Inbox, so phase 1 now waits on Chat's S, T and D4.
  - *Ask Dean:* accept that wait (recommended, since building on the Inbox
    would be thrown away by X1), or keep the Conductor chat's restating rule
    until Chat lands?
- **C9. Does the planner post asks?** The vocabulary names planners as
  members, and the fixture shows Luke posting. Chain T is not open yet.
  - *Ask Charles:* does the planner get `post_chat` with asks and
    `resolve_ask`, and is an answer to the planner's ask a wake-up?
- **C10. Mention loops.** `MAX_STEERS_PER_POST` (3) and
  `MAX_POSTS_PER_TURN` (20) bound one turn, not a chain of agents waking
  each other.
  - *Ask Charles:* add a per-agent wake bound, or leave it to 2.9's caps?

## 8. Decisions for Dean

1. **Where does the orchestrator live?**
   - A. A DM in Chat with a planless `@luke`, one per person per workspace,
     at the top of the rail. *(Recommended, if C1 and C2 resolve)*
   - B. Its own Luke row beside Chat, outside Chat's member model.
   - C. A topic channel, `#orchestrator`.
2. **The Conductor bridge before phase 2?**
   - A. Yes: a minimal bot member with a scoped token, the seed of bots.
   - B. No: wait for phase 2, when the workers are Luke agents.
     *(Recommended, given "bots later" and Chat's timing)*
3. **Answer all: how wide?**
   - A. Per channel. *(Recommended)*
   - B. Per channel, plus all of For you behind a confirm.
   - C. One at a time.
4. **Is the recommended option picked up front on an ask card?**
   - A. Yes. *(Recommended)*
   - B. No.
5. **When may the orchestrator start an agent?**
   - A. When Dean asks, and inside a rollout Dean started.
     *(Recommended)*
   - B. Also on its own judgment, under the caps.
   - C. Only after an approval ask.
6. **Brakes?**
   - A. A daily spend cap ($200) and a live-agent cap (12) per account.
     *(Recommended)*
   - B. Show spend, no caps.
   - C. A cap per agent.
7. **Who merges?**
   - A. A plan's "merge on green" switch; otherwise an approval ask.
     *(Recommended)* A future merge bot would follow the same rule.
   - B. Every merge is an approval.
   - C. Agents never merge.
8. **What wakes an existing agent?**
   - A. Its own PR's failed checks, reviews and merge-queue removal, as a
     chat notice. *(Recommended)*
   - B. Nothing: events go to Luke, who decides.
9. **Design previews?**
   - A. Pages now; live sandbox ports later. *(Recommended)*
   - B. Live ports in phase 3.
10. **Reports?**
    - A. Every agent reports as a chat post in its channel, mentioning
      `@luke` when Luke must act (C4). *(Recommended)*
    - B. Rollout reports stay planner turns, with chat posts beside them.
11. **Restating open decisions?**
    - A. No: For you holds them, and digests give a count.
      *(Recommended)*
    - B. Keep restating until phase 2.
12. **Standing preferences?**
    - A. An explicit Standing instructions field. *(Recommended)*
    - B. Company brain (#2257).
    - C. Both.
13. **Start order?**
    - A. Phase 1 as soon as Chat's S, T and D4 land. *(Recommended)*
    - B. Wait for the rollout series too.
14. **Who may answer an ask posted for Dean?**
    - A. Only the person it names, or its poster's owner; others see it.
      *(Recommended)*
    - B. Any workspace member, as Chat does now.
