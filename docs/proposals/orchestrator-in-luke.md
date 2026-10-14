# Proposal: Dean's orchestrator workflow, in Luke

Status: planning only, written 2026-10-14. Nothing here is built until Dean
answers the decisions in §7.

- **Revision 4, against main at `12302adb`:** Dean decided "Keep the Inbox;
  Chat is separate." This plan builds on the Inbox again, not on Charles's
  Chat (#2569–#2594). Revision 3, which rebuilt the plan on Chat, is
  withdrawn. Where Chat's open PRs collide with keeping the Inbox, §3.1
  lists the collisions for Charles.
- **Revision 2:** agents and the Inbox may now have no plan (§2.8).

The design show (the thread, the decision card, the batch view, and these
decisions as a form) is served from the planning workspace at
https://stage-w2169.conductor.show/ for as long as that workspace stands.

Dean's ask: "I want to have a way to do what I've been doing in this
Conductor chat but in Luke. It's getting hard to keep up with all of the open
decisions and I just want to use the Inbox for that. What functionality are
we missing for me to migrate my workflow to Luke? Let's plan that out."

## TL;DR

- **Luke already has more of this than it looks.**
  - The Inbox on main asks a structured choice: up to 6 options, each with a
    detail, one `recommended`, a note, links, code and images. It keeps a
    revision, so an answer to a changed question is refused, and an agent can
    withdraw an item with a reason. An answer reaches the agent as a message
    that steers its running turn or opens a new one.
  - Coding agents run for many turns in their own sandboxes, on a chosen
    model and effort.
  - Luke itself can search the web with citations, read code through a
    sandbox checkout and GitHub's MCP server, use every integration, run
    commands on Dean's Mac, and show pages.
- **Two open PR series build most of the agent → Luke loop:**
  - `luke-rollout` 1–15 (#2227–#2277): a `report` turn kind, a `report` tool,
    the turn-end hook, the rollout's state in Luke's standing context, and
    orchestration instructions.
  - `luke-stack` (#2377–#2391): typed lines to Luke (#2381, #2385), GitHub
    merge, close and review reports to Luke (#2389), and an agent's last
    report kept on its row (#2379).
  - Both are mergeable and were updated today. This plan builds on them
    rather than redoing them.
- **What is really missing:**
  1. A conversation with Luke that belongs to no plan, and tools that reach
     across plans.
  2. Luke, or anything outside Luke, asking in the Inbox. Today every item
     must name a coding agent.
  3. Answering a batch of decisions at once, with the recommendation picked
     up front.
  4. An agent's whole lifecycle: Luke has no stop or archive tool, GitHub
     events never wake an existing agent, nothing merges through the queue,
     and nothing archives an agent when its PRs merge.
  5. A spend cap and a cap on live agents.
- **The Inbox stays; Chat is a separate feature.** Dean, 2026-10-14: "Keep
  the Inbox; Chat is separate."
  - Decisions stay Inbox items, and the batch view stays in the Inbox.
  - The orchestrator stays a Luke row, not a Chat DM.
  - Several of Chat's open and planned PRs assume the Inbox goes: X1
    (#2580), D7, T3, and the vocabulary move in S1 (#2571). Those are
    flagged for Charles in §3.1.
- **It builds on the no-plan foundation.** On 2026-10-14 Dean decided that
  agents and the Inbox work with no plan. Worker 259 (automations, session
  `a8e3fe9e`) is planning that rework:
  - `coding_agent.plan_id` becomes nullable;
  - where planless agents appear;
  - the Inbox's breadcrumbs for a planless item;
  - the brief with no plan document.

  Every place this plan starts, lists or groups an agent or an Inbox item
  without a plan uses 259's foundation; none invents a second one. §2.8
  lists what is taken from 259 and what is added on top.
- **Phase 1 is decisions in the Inbox,** before any of the orchestrator moves.
  Today Dean's workers are Conductor workspaces, not Luke agents. So phase 1
  adds:
  - **a scoped Inbox token**, so the Conductor orchestrator can post its open
    decisions into Luke's Inbox and read the answers back;
  - **Luke as an asker;**
  - **a batch view with "Accept N recommendations";**
  - **page and PR blocks.**

  That is 8 PRs, about 3,000 lines. Dean stops scrolling through restated
  decisions in the first week, while the orchestrator itself keeps running in
  Conductor.
- **Phases 2–4** move the orchestrator itself:
  - **Phase 2:** Luke's own thread and reports from every agent (10 PRs).
  - **Phase 3:** agents that GitHub events wake, that merge through the queue
    and that archive themselves when done (6 PRs).
  - **Phase 4:** Factory as the bird's-eye view, live previews and voice in
    the thread.

## 1. The workflow, step by step, against main

"In flight" means an open PR that is not on main.

| # | Step today (Conductor) | Luke on main | Verdict |
| --- | --- | --- | --- |
| 1 | **Ask**: Dean types several asks, often while the orchestrator is busy, and they are handled mid-turn | Luke is voice only: no route or client sends a typed line (`brain-ask.ts`: `acceptAsk` is called only with `ASK_ORIGIN.SPOKEN`). The planning channel's turn policy is `STEER` (`brain-host/channel.ts:39`), so a follow-up from the same principal joins the running turn. A typed line during a spoken turn waits | **Partly.** Steering exists; typed input is in flight (#2381 route, #2385 desktop). Both are bound to one plan |
| 2 | **Brief + spawn**: brief file, fresh workspace on a fresh branch off main, chosen model and effort | `start_coding_agent {task?, model?, effort?}` (`coding-agent-tools.ts:168-192`). The task is up to 16,000 chars; the model and effort come from AI Gateway's catalog, a long window is the default, and Fast is a suffix. The repository is the plan's; the base is the default branch | **Partly.** Only on the current plan. No base branch (rollout #2245 adds one) and no context window choice. Research or design workers fit (`show_page`, `search_web`) |
| 3 | **Workers run long**: research, code, checks, PRs, answer Devin, merge through the queue, babysit CI, rebase across others' merges | Many turns over days: the sandbox is stopped at turn end and resumed from its snapshot (`coder/hooks/store.ts`). Within a turn, an agent watches its own checks for up to 3 rounds (`coder-host/instructions.ts:80-88`). The prompt says never to merge, though nothing enforces it | **Partly.** Nothing wakes an agent between turns: no CI, review, merge-queue or other-agent event. No merge-queue tool. No waiting on another PR |
| 4 | **Workers report back** to the orchestrator: "merged #2553", "round 3 live at URL", "Decision needed: A/B/C" | No agent → Luke path on main. Luke learns only by calling `list_coding_agents` / `read_coding_agent`, or from the 5 newest `edit_plan` notes in his standing context (`brain-host/planning.ts:301-376`). Decisions go to the Inbox (the developer), not to Luke | **Missing on main, in flight:** rollout #2241, #2249, #2265, #2269 (report turn, tool, end hook) and #2389 (GitHub reports). Only rollout workers report |
| 5 | **Verify, track, archive**: `gh pr view`, the `.context/workers.md` tracker, archive a workspace once its PRs merge | `read_coding_agent` returns the PR as GitHub holds it (`published`). The desktop lists one plan's agents. Archive is a desktop route only | **Partly.** No cross-plan tracker, no stop or archive tool for Luke, and no archive on merge. Rollout #2255 puts one plan's rollout state in Luke's context |
| 6 | **Relay and steer**: plain-language summaries with preview URLs, "why" answered from code or the web, stop, freeze or redirect workers, Dean's answers written back verbatim | Luke reads code (`run_in_repository`, `show_code`, GitHub MCP through `connection_execute`) and the web (`search_web`, `read_web_page`, cited). `message_coding_agent` steers or opens a turn | **Partly.** All of it is bound to one plan, and Luke has no stop tool. Previews are pages: sealed HTML in the side panel with no network, not a URL |
| 7 | **Decisions**: every reply restates 17–25 open decisions; the stopgap is a web page with radios, the recommendation preselected, a context line, links, a note and "Copy answers" | The Inbox: choice, recommended, note, revision, withdraw, routing. The account-wide held read badges the sidebar and the Dock and raises toasts. Grouped by plan, with Needs you | **Mostly there.** Missing: Luke or an outside agent as the asker, a batch answer with "accept recommendations", the recommendation picked up front, and page or PR blocks |
| 8 | **Standing preferences** kept as memory | None across plans. Luke's prompt is a constant; the only account-level state is preferences (voice, default model) | **Missing.** Company brain (#2257, draft, conflicting) adds automatic memory |
| 9 | **Dean's Mac**: one-shot commands | `run_on_mac`, both roles, no approvals (decided in `one-agent-runtime.md` §8, Decision 5) | **Has** |
| 10 | **External systems**: GitHub, Vercel, Linear, Slack, Sentry, PostHog | Integrations for both roles: GitHub, Granola, Linear, Mercury, Neon, Notion, PostHog, Sentry, Slack, Supabase, Vercel, Y Combinator (`agent-runtime/servers.ts`). An agent's `gh` runs on an installation token held at the sandbox firewall | **Has.** The merge queue is a GraphQL call nobody has wrapped |

### 1.1 The expected gaps, confirmed or refuted

| Expected gap | Finding |
| --- | --- |
| **An orchestrator mode across plans** | **Confirmed.** Every planning tool is bound to the conversation's plan (`brain-host/host.ts:378-433`), and every conversation is one plan's (`plan.conversation_id`). The table itself does not tie a conversation to a plan, so a conversation no plan references is a small step. Voice sessions require a `planId` (`voice/opening.ts:437`) |
| **Agents reporting back to Luke** | **Confirmed missing on main, in flight.** The rollout series makes a report a turn on the plan's conversation through `acceptAsk` (#2249). Phase 2 widens it from rollout workers to every agent and aims it at whichever conversation started the agent |
| **Structured decisions in the Inbox** | **Mostly refuted:** options, recommendation, note, routing and withdraw are all on main (`inbox-wire.ts`, v4). Missing: Luke or an outside asker (`inbox_item.agent_id` is `NOT NULL`), the recommendation picked up front, batch and accept-all, and "superseded" shown while Dean reads. The revision check exists; the desktop does not yet say what changed |
| **Worker lifecycle** | **Partly confirmed.** Brief, spawn with model and effort, and many turns: yes. Waking on events: no. GitHub events only refresh `published` (`github-webhook-app.ts`), and automations only start new agents (`automation-runs.ts`). Archive on merge: no. One branch and one PR per agent (`coding_agent.published`) |
| **Design previews at a shareable URL** | **Partly refuted.** `show_page` serves static or scripted mockups in Luke's side panel, versioned per plan, which covers Dean's "show" rounds when he views them in Luke. Missing: a live server from the sandbox at a URL, and a page that others outside Luke can open |
| **Merge-queue and CI babysitting without a prompt** | **Confirmed.** CI is watched only inside a turn, and no merge tool exists |
| **A tracker (Factory)** | **Confirmed.** No cross-plan agent read. Factory has no design in this repository; its rounds live in workers' workspaces |
| **Standing preferences / memory** | **Confirmed.** #2257 is the in-flight automatic memory; no explicit instructions field exists |
| **Typed chat with mid-turn interjections** | **Partly.** Steering is on main; typed is in flight (#2381, #2385), per plan |
| **Luke reading code and the web** | **Refuted, it has this:** `run_in_repository`, `show_code`, GitHub MCP, and `search_web` / `read_web_page` with citations. The planner prompt names only `run_in_repository` for code, so the instructions should mention GitHub search for code in other repositories and on other branches |

## 2. The shape: what the loop looks like in Luke

### 2.1 Where Dean types

A sidebar row, **Luke**, under Home and Inbox, opens the account's own
conversation with Luke. It is tied to no plan (Decision 1). It is the
Conductor chat's replacement:

- a typed composer whose lines steer a running turn, as the planning
  channel's `STEER` policy already does;
- Luke's tool rows, drawn as the transcript draws them;
- the agents' reports, folded into "While you were away";
- a side panel listing every live agent, in any plan or in none, with the
  day's spend. This panel is the tracker that replaces `.context/workers.md`.

Each plan keeps its own conversation for the work of that plan. The account
thread is the one place that reaches across plans.

Why not a plan named "Orchestrator"? It would reuse the plan conversation
for free, but it would carry a plan document nobody writes. Its tools would
still have to reach other plans, so it saves one migration and costs a
permanent oddity. Once agents can run with no plan (§2.8), Luke never needs
a plan just to hold the agents he starts.

### 2.2 How Luke briefs and starts agents

- **An agent lives in a plan when the work has one, and in none when it
  doesn't.**
  - A topic of Dean's that has a plan (@-mentions, Terminal, Automations)
    keeps its agents, Inbox group, Stack tab and automations together.
  - A one-off ask ("find out why the Vercel connector fails") starts a
    planless agent, on 259's foundation.
  - Luke never makes a plan only to hold an agent.
- **The coding-agent tools take an optional `planId`.**
  - In a plan's own conversation it defaults to that plan.
  - In the account thread, leaving it out starts a planless agent, which
    then needs a `repository`, since today the plan supplies one. That
    repository is checked against the GitHub installation the same way,
    from wherever 259 settles a planless agent's repository.
  - `start_coding_agent` also gains `base` (from rollout #2245) and
    `contextWindow`.
- **The brief is the `task`** (16,000 chars).
  - A planless agent's brief is the task alone, in 259's no-plan-document
    brief.
  - A design worker is a coding agent whose brief asks for a doc and a page.
  - A rollout is the `luke-rollout` builder-and-keeper pair, and stays per
    plan.
- **Luke gains `stop_coding_agent` and `archive_coding_agent`.** These are
  the desktop's routes, offered as tools.
- **Guards:**
  - Luke starts an agent only when Dean asks, or within a rollout Dean
    started (Decision 5).
  - Every start counts against the account's live-agent cap and daily spend
    cap (Decision 6). Past either, Luke refuses and posts an Inbox item to
    raise it.

### 2.3 How reports arrive

- **Every agent reports to the conversation that started it,** using the
  rollout series' report turn (Decision 10).
  - An agent Luke started from the account thread reports there, planless or
    not.
  - An agent started inside a plan reports to that plan's conversation.
  - An automation's run reports wherever the automations rework lands its
    runs. The account thread is one candidate (scope proposal D5).
- **Report kinds:**
  - from the agent, through #2265's tool: `pr_opened`, `ci_green`,
    `blocked`, `question`, plus `page_ready` for a design round;
  - from the turn-end hook (#2269): `finished`, `failed`, `stopped`;
  - from GitHub (#2389): `merged`, `closed`, `changes requested`.
- **Luke verifies before he relays.** He reads the PR itself, as the
  orchestrator does with `gh pr view`, and only then tells Dean. Reports that
  need nothing from Dean fold into one "While you were away" block in the
  thread; anything that needs Dean becomes an Inbox item.
- **The standing rule changes.** Luke's replies stop restating the open
  decisions. They say "16 open decisions, 3 new" and link the Inbox
  (Decision 11).

### 2.4 The decision card

This is main's Inbox pane, the D/E layout: the list grouped by plan, and the
chosen item read as a thread with a docked composer. For a planless item, the
list group and the pane's crumbs follow 259's Inbox breadcrumbs rather than a
scheme of this plan's. The card gains:

- **an asker that can be Luke or an outside agent,** named by an AgentRef
  whose hover card shows the model, effort, plan, turns, PRs and spend;
- **the recommended option picked up front.** Send alone accepts it, and the
  composer's hint says what Send will do (Decision 4);
- **page and PR blocks:**
  - a `page` block opens a `show_page` page in the side panel;
  - a `pull` block names a PR and draws its live state with the PR chip
    (wire v5);
- **Ask Luke,** which opens the account thread with the item quoted, for a
  "why" that does not answer the item;
- **a "changed while you were reading" line.** It appears when the asker
  re-posts under the same key; the answer is held, not sent against the old
  revision. That check is main's; the line is new.

### 2.5 The batch view

- **How it opens:** press a group header in the list, or its **Answer
  all**. A group is a plan, or whatever group 259's rework gives planless
  items (Decision 14).
- **What it shows:** every open choice in that group, as one form in the
  pane. Each question starts on its recommendation, with an optional note.
- **The button:** reads **Accept 7 recommendations** until Dean changes
  one, then **Send 7 answers · 1 changed**.
- **The request:** one request carries one answer per item, each naming its
  revision (a new `POST /api/inbox/answers`). An item the asker changed in
  the meantime is refused alone and comes back marked, while the rest go.
- **Approvals and forms:** these stay one at a time. A batch is only for
  choices.

Decision 3 is whether an Inbox-wide accept-all exists as well.

### 2.6 How a decision travels

1. **Ask.** An agent, or Luke, calls `post_to_inbox`. During the migration
   the Conductor orchestrator posts through the Inbox token instead. The
   post carries a key, title, blocks, a choice with a recommendation, and
   `needsReply`. Posting under the same key replaces the item and moves its
   revision on.
2. **Wait.** The account-wide held read (`account-inbox-wire.ts`) badges the
   sidebar and the Dock and raises a toast. A coding agent's turn ends or
   carries on with other work.
3. **Answer.** Dean answers one item, or a plan's batch. Each answer names
   its revision.
4. **Route.**
   - **A coding agent** hears the answer as a message that steers or opens
     its turn. This is main's behavior, in `coding-agents-app.ts:813-873`.
   - **Luke** hears it as a turn on the conversation that asked, under a new
     ask origin `inbox`, through the same `acceptAsk` door reports use.
   - **An outside asker** reads it with a held read past its cursor.
5. **Continue.** The asker reads the pick and the note verbatim and goes on.
6. **Settle.** The asker's next report says what it did. Luke updates the
   tracker and archives the agent once its PRs are verified merged.

### 2.7 The bridge for phase 1

- **What it is:** a scoped **Inbox token**, minted in Settings › Inbox
  access. The service stores only its hash and shows the token once.
- **What it may do:** post, close and read its own items, in a plan the
  account can reach or in none, read their answers with a held read, and
  list plan names. Nothing else. A leaked token can ask Dean questions; it cannot read a plan, a
  transcript or a key.
- **How it is used:** the Conductor orchestrator holds the token and posts
  each open decision under a stable key, so a re-post keeps the item
  current. It reads answers past its cursor at the start of each of its
  turns and relays them verbatim to the right worker.
- **How it shows:** the asker is shown as the token's name, for example
  "Orchestrator (Conductor)".
- **When it goes:** it becomes unnecessary once phase 2 moves the
  orchestrator into Luke. It could stay as "any agent can ask you in Luke"
  (Decision 2).
- **Where its items group:** a topic that has a Luke plan posts into it;
  anything else is a planless item, grouped as 259 groups planless items
  (Decision 14).

### 2.8 Built on the no-plan foundation (worker 259)

Dean's decision of 2026-10-14: "if we want to support automations as
first-class, they should be able to run agents outside of a plan." Worker
259 (automations, session `a8e3fe9e`) is planning the rework. This plan
needs the same foundation for Luke's planless starts, the tracker, and
planless decisions, so it takes 259's and adds only what is Luke's own.

| Piece | 259 owns | This plan takes it for | This plan adds |
| --- | --- | --- | --- |
| **`coding_agent.plan_id` nullable** | The column, the store, every read that assumed a plan | 2.4: Luke starts a planless agent | Nothing to the column |
| **Where a planless agent appears** | The sidebar, Home, and wherever its tab opens | 2.8's tracker: the same account-wide agent read, widened with the last report (#2379) and spend, never a second read | The thread's side panel over that read |
| **Inbox breadcrumbs, and `inbox_item.plan_id` nullable** | How a planless item is listed, grouped and crumbed | 1.4's batch groups, 1.6's planless asks from Luke, 1.7's planless token items | 1.1's asker columns on the same table (see below) |
| **The brief with no plan document** | What a planless agent is briefed with, and how `read_plan` / `edit_plan` answer with no plan | 2.4: a planless start's brief is its `task` | Nothing |
| **A planless agent's repository** | Where it comes from (an automation names one) | 2.4's `repository` input, checked the same way | Nothing |
| **A planless agent's pages** | Where `show_page` writes when there is no plan: the page store keys pages by plan today | Design workers, which are often planless, show their rounds as pages | Nothing, but this plan depends on the answer |

Two things go the other way, owned here and offered to 259:
- **The planner with no plan.** The account thread (2.1) is a planning
  conversation no plan references. It is the planner-side twin of 259's
  planless coder. Both should bind a tool call with `planId: string | null`
  rather than adding a second "account" binding. Each plan-bound tool says
  plainly what it does with no plan:
  - `draw_on_board` and `look_at_board` refuse;
  - `show_code` and `run_in_repository` need a named repository;
  - `show_page` follows 259's answer for planless pages.
- **1.1 and 259's Inbox migration touch the same table.** 1.1 makes
  `inbox_item.agent_id` nullable and adds `asker_kind` / `asker_id`. 259
  makes `inbox_item.plan_id` nullable. They should be one expand migration
  if they land together, or the second rebases onto the first, with one
  check constraint covering both. Nothing here makes a planless item.
  Whichever lands first, a planless item is whatever 259 says it is.

## 3. Phasing

Sizes are rough diff sizes: S under 200 lines, M 200–600, L over 600. Every
desktop PR needs Dean's own `verify.sh` evidence: CI builds nothing for the
Mac, and per standing preference the workers run it themselves, never Dean.

### Phase 1: decisions in the Inbox (8 PRs, about 3,000 lines)

The goal is that Dean stops using the Conductor chat for decisions.

| # | PR | Size | Depends on |
| --- | --- | --- | --- |
| 1.1 | **The asker.** `inbox_item.agent_id` becomes nullable, with an `asker_kind` (`agent`, `luke`, `token`) and `asker_id`, held by a check constraint. Store, wire and the account read name the asker. Expand-only migration; a sibling `__tests__/` store test, including a cross-account read refusal | M | 259's `inbox_item.plan_id` migration: one migration with it, or rebased onto it (§2.8) |
| 1.2 | **Batch answers.** `POST /api/inbox/answers`: up to 25 `{itemId, revision, reply, clientKey}`, an outcome per item, idempotent per client key | M | none |
| 1.3 | **Recommended picked up front** in the pane, and the Send hint. Desktop only | S | none |
| 1.4 | **The batch view:** a group's Answer all (a plan, or 259's planless group), Accept N recommendations / Send N answers, and stale items marked | L | 1.2, 1.3; 259's Inbox groups for planless items |
| 1.5 | **Page and PR blocks** (`INBOX_WIRE_VERSION` 5, JSON Schema goldens re-recorded). The desktop draws them; an older desktop draws its "newer Luke" placeholder | M | none |
| 1.6 | **Luke asks.** The planner role gets `post_to_inbox`, `close_inbox_item` and `read_inbox` as registry entries (`roles: [PLANNER, CODER]`). An answer opens a turn on the asking conversation (`ASK_ORIGIN.INBOX`). Luke's open-item bound is 40, not an agent's 20 | M | 1.1; lands after rollout #2249, whose `acceptAsk` origin it mirrors |
| 1.7 | **The Inbox token.** Settings › Inbox access mints, names and revokes a token, stored as a hash. `/api/inbox/external/{items,answers,plans}` under it, with the rate brake | M | 1.1 |
| 1.8 | **The bridge skill.** `.agents/skills/luke-inbox/`: how the Conductor orchestrator posts, keys and reads, with a one-file script | S | 1.7 |

1.1, 1.2, 1.3 and 1.5 can run in parallel. Four agents would take about a
week.

### Phase 2: Luke's thread, reports, the tracker (10 PRs, about 4,000 lines)

The goal is that the orchestrator moves into Luke. It depends on the rollout
series #2241–#2269 and the typed line #2381/#2385 landing first.

| # | PR | Size | Depends on |
| --- | --- | --- | --- |
| 2.1 | **The account conversation.** The account row references one conversation no plan references (`openAccountConversation`). Planning tools bind `planId: null`, as 259's planless coder does, and each says what it does with no plan rather than refusing with "this plan no longer exists" | M | 259's no-plan binding, if it lands first |
| 2.2 | **Its typed route.** `POST /api/luke/messages`, #2381's shape without a plan, steering a running turn | S | 2.1, #2381 |
| 2.3 | **Desktop: the Luke row, thread and composer,** on the agent tab's transcript parts (`one-agent-runtime.md`'s one part view) | L | 2.2 |
| 2.4 | **Tools across plans, and with none:** `list_plans`, `create_plan` (only when Dean asks for a plan), and an optional `planId` on the coding-agent tools; none means a planless agent with a `repository`. Workspace plans act as Dean, as the desktop does | M | 2.1; 259's nullable `coding_agent.plan_id` and no-plan brief |
| 2.5 | **`stop_coding_agent`, `archive_coding_agent`** for Luke | S | 2.4 |
| 2.6 | **Every agent reports:** #2265's tool and #2269's end hook, widened past rollout workers and aimed at the starter conversation (a `started_by_conversation_id` column), plus `page_ready` | M | rollout #2269 |
| 2.7 | **The fold and the instructions:** "While you were away", verify-before-relay, and the decisions count in place of restating | M | 2.6 |
| 2.8 | **The tracker:** 259's account-wide agent read (planless agents included), widened with live and recently archived agents, PRs, the last report from #2379, and spend; and the thread's side panel over it | M | 2.3, stack #2379, 259's planless-agent read |
| 2.9 | **Standing instructions:** a Settings field read into Luke's standing context. Luke may propose an edit as an Inbox approval | S | 2.1 |
| 2.10 | **Spend and spawn caps:** a daily spend cap and a live-agent cap per account, checked at every start (Luke's, the desktop's, automations'), with a refusal Luke reads | M | none |

### Phase 3: long-running workers (6 PRs, about 2,400 lines)

The goal is no babysitting.

| # | PR | Size | Depends on |
| --- | --- | --- | --- |
| 3.1 | **GitHub wakes the agent.** Failed checks on its own PR, `pull_request_review` / `pull_request_review_comment` / `issue_comment` on it (Devin's review), and `merge_group` removal. Each becomes a message to the agent, keyed by delivery, beside #2389's report to Luke | M | stack #2389 |
| 3.2 | **`enqueue_pull_request`**, GraphQL `enqueuePullRequest` on the installation token, allowed when the plan's "merge on green" is on (Decision 7) | M | none |
| 3.3 | **Waiting on another PR.** An agent says `wait_for {pr}` and is woken when that PR merges or closes | M | 3.1 |
| 3.4 | **Archive on merge.** When every PR an agent published is merged and verified on the base, it is archived and reported to Luke | S | 3.1 |
| 3.5 | **Several PRs per agent.** `published` becomes a list, so a design-then-build worker keeps both. The rollout's builder per PR may make this unneeded | M | none |
| 3.6 | **A long idle.** A stopped sandbox whose snapshot expired is rebuilt from the agent's pushed branch rather than failing | M | none |

### Phase 4: bird's-eye view, previews, voice (sized when reached)

- **Factory** reads 2.8's tracker read; it is not a second tracker. Its
  design rounds live in workers' workspaces, not in this repository.
- **Live previews:** a `preview_port` tool exposing a port of the sandbox at
  Vercel Sandbox's public domain, for a running app. Pages already cover
  mockups (Decision 9).
- **Voice in the account thread.** This needs a voice session without a
  `planId`.
- **Company brain** (#2257), if Decision 12 picks it.
- **Bots: later, not designed here.** Dean, 2026-10-14: "let's not do
  dependency updates. We can maybe add an auto-approving/auto-merging bot
  once we add bots (like also a code review bot)." So there is no
  dependency-update work in any phase. A bot is a future feature; this is
  only where it would fit:
  - **What it is:** an agent with a standing role, as the rollout's keeper
    is a role on `coding_agent`. It would most likely be planless, on 259's
    foundation.
  - **What starts or wakes it:** an automation (the GitHub and schedule
    triggers on main) or a GitHub event, through 3.1's single reading of a
    delivery.
  - **An approve-and-merge bot** would act through 3.2's
    `enqueue_pull_request`, under whatever merge rule Decision 7 sets.
  - **A code-review bot** would answer the same review and PR events 3.1
    reads.
  - **Limits:** like any agent, it counts against 2.10's caps and shows in
    2.8's tracker.
  - **The one thing phase 3 should leave room for:** 3.1 skips events sent
    by bots, to avoid loops. Once Luke has bots of its own, that guard must
    tell their events apart from outside bots' events, rather than dropping
    them all.

### Overlaps with in-flight work

- **Chat (Charles, #2569–#2594, separate by Dean's decision):** this plan
  does not build on it. Where the two meet, §3.1 lists the collisions.
- **Worker 259, agents and the Inbox with no plan** (session `a8e3fe9e`):
  the largest overlap, set out piece by piece in §2.8.
  - 1.1, 1.4, 2.1, 2.4 and 2.8 depend on its rework.
  - 1.1 shares its Inbox migration.
  - Its answer on planless pages decides where planless design workers show
    their rounds.
- **`luke-rollout` 1–15:** phase 2 is its consumer. Its report turn, tool,
  hook and standing context land first. Its "Running the rollout"
  instructions stay per plan, and 2.7 adds the account thread's.
- **`luke-stack`:**
  - B1/B2 (typed line) is 2.2's model.
  - D2 (GitHub reports) is 3.1's neighbor; the same webhook read feeds both.
  - A1 (`last_report`) feeds 2.8.
  - A2/A3 (Stack tab) stays the per-plan view; Factory is the cross-plan
    one.
- **`one-agent-runtime.md`:** 1.6 and 2.5 are registry entries with roles.
  Luke's inbox tools are the coder's, under one implementation.
- **Automations** (backend 1–5 on main, 6–12 frozen drafts, scope proposal
  open):
  - Dean's no-plan decision replaces the scope proposal's D4 ("a plan Luke
    makes to hold its runs"): a planless automation's runs are planless
    agents, on 259's rework.
  - D5 ("run in the plan's Luke conversation, later") meets 2.1 and 2.6. An
    automation could target the account thread.
  - 3.1 and `automation-github.ts` should share one reading of a delivery.
  - 2.10's caps apply to automation starts too.
- **Factory** (design only): phase 4. Its data comes from 2.8, which is
  259's agent read widened, so its design should not invent a third read.
- **@-mentions** (planned): the account thread's composer is where Dean
  names an agent or plan ("@Factory round 4"). Section links are what an
  Inbox context line links to.
- **Terminal** (being built: its design is on main as #2574, and the xterm
  surface landed as terminal 5/9, #2581). It doesn't overlap phase 1 or 2. A
  shell in an agent's sandbox complements 3.6 but does not replace it.
- **Web/links (worker 273):** reports, digests and the bridge all need a
  stable link to an Inbox item, an agent and a plan. Phase 2's fold should
  use 273's links, not mint its own.
- **Company brain (#2257, draft, conflicting):** Decision 12.
- **`conductor/inbox-decisions-into-the-plan`:** superseded by #2218's
  `edit_plan` guidance. Nothing here revives it.

### 3.1 Collisions with Chat, to raise with Charles

Dean has decided the Inbox stays and Chat is separate. Chat's open PRs and
the plan their bodies describe were written on the premise that Chat
replaces the Inbox. Each item below is where that premise meets this plan.

- **K1. X1 (#2580, open, held) deletes the Inbox.** It removes the tables,
  the four routes, the coder's inbox tools, the store, the account digest,
  the desktop's Inbox, and the Dock badge. Chat's chains also plan:
  - D7 ("the Inbox goes");
  - T3 (the coder's inbox tools go);
  - S4a (the Inbox store re-implemented over the chat store);
  - S4b (the Inbox's rows copied into chat).

  *Ask Charles:* close X1, and drop D7, T3, S4a and S4b from Chat's plan.
  Phase 1 here extends exactly what they remove.
- **K2. S1 (#2571) moves the Inbox's vocabulary into `chat-wire.ts`.** The
  Inbox's block, ask and reply shapes move there, and `inbox-wire.ts` keeps
  its names only as aliases "until X1". Phase 1.5 adds page and PR blocks
  to the Inbox (`INBOX_WIRE_VERSION` 5). With S1 on main, that change would
  edit `chat-wire.ts` and change Chat's asks too, and the reverse would
  also hold.

  *Ask Charles:* keep `inbox-wire.ts` the owner of the Inbox's shapes, with
  Chat importing or copying them, or agree that the two vocabularies move
  together on purpose.
- **K3. Two ways for an agent to ask the developer.** Coding agents keep
  `post_to_inbox`. Chat gives them `post_chat` with an ask (T1b, and #2594's
  ask store) that has the same shapes.

  *Ask Dean and Charles:* is a decision always an Inbox item (this plan's
  premise), with chat for conversation? Each agent's instructions must say
  which to use, or the model splits decisions between two places Dean has
  to read.
- **K4. Shared answer pieces.** D2 (#2582) draws Chat's ask cards from the
  Inbox pane's own pieces (`ChoiceOptions`, `FormFields`, `inboxReply`), and
  D7 would move them out. Phase 1.3 and 1.4 change those pieces: the
  recommended option picked up front, and the batch. Sharing them is fine
  if they stay the Inbox's and Chat imports them, and each change is checked
  against both.
- **K5. Two "waiting on you" lists and badges.** Chat's For you lists open
  asks, DMs and mentions; the Inbox's Needs you lists open items. Both
  badge the sidebar.

  *Ask Dean:* should For you leave asks to the Inbox, or should one list
  link the other, so the count Dean watches is one number?
- **K6. The orchestrator does not live in Chat.** Chat's `@luke` is one per
  plan (`chat_member` keys a planner by `plan_id`). The orchestrator stays
  the Luke row of §2.1. If Chat later wants an `@luke` that belongs to no
  plan, it should be the same planless planner conversation as 2.1, not a
  second one.
- **K7. Worker 259's Inbox breadcrumbs stay on the Inbox.** Revision 3
  suggested moving that work to Chat; it no longer should.

## 4. Risks

- **Cost of long-running agents.**
  - Dean ran about 270 workers in two weeks. Each coding agent's turn may run
    up to 24 hours (`TURN_ABANDON.CODING_AGENT_AFTER_MS` is 25), and
    sessions have no token cap (`coder/agent.ts`).
  - The meter counts and refuses nothing (`one-agent-runtime.md` Decision
    6), and there is no spend cap today.
  - **Mitigation:** 2.10's caps, spend on the thread's bar and on each
    agent's hover card, and archive on merge (3.4), which stops a forgotten
    agent from being woken.
- **Runaway spawning.**
  - A model that starts agents across plans can fan out.
  - **Mitigations:**
    - the live-agent cap;
    - starts only on Dean's ask or inside a rollout Dean started
      (Decision 5);
    - the idempotency key `start_coding_agent` already takes from eve's call
      id, so a replayed call starts nothing twice;
    - the rule that a report never starts an agent by itself.
- **Wake loops.**
  - An agent woken by its own PR's failed check can push, fail and wake
    forever.
  - **Mitigations:**
    - 3.1 skips events sent by bots, as `automation-github.ts` already does;
    - a bound of wake-ups per PR per day, after which the agent posts
      `blocked` and stops.
- **Permissions.**
  - In a workspace plan, an agent acts as the member who started it
    (`steer.ts`). Luke's cross-plan tools act as Dean and reach only plans
    Dean can reach, through the same workspace check the routes use.
  - An item is answered only by the account it belongs to
    (`inbox_item.user_id`). Whether workspace members see each other's
    decisions is out of scope here.
  - The Inbox token is scoped to the Inbox alone.
- **Secrets** (AGENTS.md "Never").
  - An Inbox item, a report and the thread are Gateway answers and events,
    so none may carry a credential.
  - `run_on_mac` output may reach the conversation under its carve-out, but
    must not be copied into an Inbox item or a report. 1.6's and 2.6's
    instructions say so, and the post tools refuse a `.env`-shaped image
    path as `show_page` does.
  - The Inbox token is a credential:
    - stored as a hash;
    - shown once;
    - never written to a trace, counted event or fixture;
    - its request logs carry the token's id, not the token.
  - The Conductor orchestrator holding it in its sandbox is the one new
    place a Luke credential lives outside Luke.
- **The hosted runtime's limits.**
  - A planner turn is abandoned after an hour (`TURN_ABANDON.AFTER_MS`), so
    the account thread's turns must stay short. Long work goes to agents,
    and Luke's own research to background `delegate`, as Decision 3 of
    `one-agent-runtime.md` already makes the planner do.
  - The account thread grows without end. eve compacts at 80% of the
    window, and a rotated session is seeded with only the last 60 messages.
    So the tracker and the open decisions must reach Luke from rows in his
    standing context, never from what the transcript remembers.
  - A stopped sandbox's snapshot can expire during a long wait (3.6).
- **Two orchestrators for a while.** During phase 1 the Conductor
  orchestrator posts and Luke's own agents post. Items stay one list
  because both are grouped as the Inbox groups everything, by plan or 259's
  planless group; the asker's glyph says which is which.

## 5. What this does not do

- It does not give Luke a second runtime. Every new tool is a registry entry
  of `one-agent-runtime.md`'s roles.
- It does not move Dean's memory files or this repository's `AGENTS.md`.
  Nothing goes into `AGENTS.md` without Dean's explicit approval.
- It does not answer the automations scope proposal's decisions. It only
  names where they meet this plan.

## 6. The decisions page itself

The stopgap page's shape, per question `{section, id, title, context,
options[], recommended, note}`, maps one to one onto an Inbox choice: a
plan, a key, a title, a Markdown block, options, `recommended`, and the
answer's note. Phase 1's batch view is that page, inside Luke, with answers
routed instead of copied. The show ends with this proposal's own decisions
drawn that way.

## 7. Decisions for Dean

1. **Where does the orchestrator conversation live?**
   - A. A **Luke** row in the sidebar: the account's own thread, tied to no
     plan. *(Recommended)*
   - B. The Home page: a thread under "Welcome back".
   - C. A plan named "Orchestrator", reusing the plan conversation.

   *Why A:* a hundreds-of-turns thread needs its own place. B crowds the page
   that just shipped. C carries a plan document nobody writes, and since
   agents can now run with no plan, nothing needs a plan to hold them.
2. **How does phase 1 get decisions into the Inbox while the workers are
   still in Conductor?**
   - A. A scoped Inbox token: the Conductor orchestrator posts and reads
     answers until phase 2, then the token stays as "any agent can ask you
     in Luke". *(Recommended)*
   - B. The same token, deleted once phase 2 lands.
   - C. No bridge: decisions reach the Inbox only as workers move into Luke,
     in phase 2.

   *Why A:* relief in week one, for two small PRs. C leaves Dean scrolling
   until phase 2.
3. **Accept-all: how wide?**
   - A. Per plan: the batch view's "Accept N recommendations".
     *(Recommended)*
   - B. Per plan, plus one Inbox-wide "Accept all recommendations" behind a
     confirm.
   - C. Neither: one at a time.
4. **Is the recommended option picked up front?**
   - A. Yes: Send alone accepts it, and the hint says so. *(Recommended)*
   - B. No: Dean presses an option first.
5. **When may Luke start an agent?**
   - A. When Dean asks, and inside a rollout Dean started. *(Recommended)*
   - B. Also on his own judgment, such as a follow-up fix after a merge,
     under the caps.
   - C. Only after an Inbox approval for each start.
6. **What brake on spend and spawning?**
   - A. A daily spend cap (default $200) and a live-agent cap (default 12)
     per account, both in Settings. Luke refuses past them and asks to
     raise them. *(Recommended)*
   - B. Show spend, no caps.
   - C. A cap per agent instead.
7. **Who merges?**
   - A. A plan's "merge on green" switch. While it is on, the agent enqueues
     its own green PR; while it is off, it asks in the Inbox.
     *(Recommended)*
   - B. Every merge is an Inbox approval.
   - C. Agents never merge; Dean does.

   A future auto-merge bot (§3, Phase 4, "Bots") would act under this same
   rule rather than a second one.
8. **What wakes an existing agent?**
   - A. Its own PR's failed checks, review comments and changes requested,
     and removal from the merge queue. A merge only reports to Luke.
     *(Recommended)*
   - B. Nothing wakes the agent. Every event goes to Luke, who messages the
     agent if he judges it needed.
9. **Design previews?**
   - A. Pages (`show_page`) for mockups now; a live sandbox port only when a
     running app is needed (phase 4). *(Recommended)*
   - B. Build live port previews in phase 3.
10. **Which agents report to Luke?**
    - A. Every agent, to the conversation that started it. *(Recommended)*
    - B. Only rollout workers, as in flight.
11. **Does Luke keep restating open decisions?**
    - A. No: replies say "N open, M new" and link the Inbox; the rule
      retires once phase 1 lands. *(Recommended)*
    - B. Yes, until phase 2.
12. **Standing preferences?**
    - A. An explicit "Standing instructions" field in Settings, which Luke
      can propose edits to through an Inbox approval. *(Recommended)*
    - B. Company brain's automatic memory (#2257).
    - C. Both.
13. **Start order?**
    - A. Phase 1 now, in parallel with landing the rollout and stack series.
      Only 1.6 waits, on #2249. *(Recommended)*
    - B. Land the rollout and stack series first, then start phase 1.

    *Why A:* 1.1–1.5, 1.7 and 1.8 touch nothing the rollout series touches,
    so waiting delays Dean's relief for no gain.
14. **How do planless decisions group in the Inbox and the batch view?** This
    only matters for the bridge and for Luke's own asks; 259's rework decides
    the planless breadcrumbs themselves.
    - A. As 259 groups planless items. The bridge posts into a plan wherever
      a topic of Dean's has one, and posts planless otherwise.
      *(Recommended)*
    - B. A free topic label on every item, with a plan or without.

    *Why A:* B invents a second grouping beside plans and 259's planless
    group, which is what building on one foundation rules out.
