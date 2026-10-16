# Proposal: a code review bot in Luke

Status: Dean approved the design on 2026-10-15 ("build GitHub events and
webhooks and then the code review bot on top"). The trigger work shipped as
#2768 (GitHub events on workspace automations and `pull-request-updated`),
then #2770 (the webhook trigger), #2776, and #2778 (the editor's Trigger
section). The bot itself is held for Dean to try first: the trigger
decisions (D3, D4) and the preset with its prompt and guards (D6, D10). The
spike that measured it was #2753. The research notes are in
`code-review-bot/research.md`, the measurements in
`code-review-bot/results.md`, and the visual in `code-review-bot/index.html`.

Dean's ask: "Let's spike out a code review bot implementation overnight. Do
thorough research." It is the first of the "bots" roadmap items; an
auto-approve and auto-merge bot comes later.

## TL;DR

- **A code review bot is an automation preset, not a new subsystem.**
  - The trigger: "a pull request is opened, marked ready, or pushed to in
    these repositories."
  - The prompt: review it and post one GitHub review.
  - Each run starts an ordinary coding agent with the repository checked out
    and `gh` reaching GitHub as `luke[bot]`.
  - All the bot's behavior is in a ~6k-character prompt the developer can
    read and edit: the noise policy, deduping across pushes, and resolving
    fixed threads.
- **What's new is small** (the draft PR, ~180 lines of logic plus tests):
  - one trigger event, `pull-request-updated`;
  - GitHub triggers on workspace automations, which #2746 made but no
    delivery could fire;
  - a run starts in the repository the event named;
  - the preset itself.
  - No new permission, table, route, or GitHub subscription is needed.
- **It works.** On the harness (Opus 5.5 high, the task text exactly as Luke
  builds it):
  - **36 posted comments, 0 wrong, 0 nitpicks.**
  - **4/4 planted bugs** found on a [throwaway PR](https://github.com/ReviewStage/luke/pull/2751).
    A push that fixed two of them got those two threads resolved and nothing
    reposted.
  - Two real bugs found that are **live on main** today: Home's Inbox
    mismatch from #2741, and #2746's PATCH gap.
  - $0.24–0.83 and 40–150 s per review.
- **It is quieter than Devin Review here, and finds less.**
  - Replayed at the commits Devin first reviewed, the final prompt found 6
    of Devin's 14 findings, plus 3 real ones Devin missed.
  - Devin's findings were acted on 94% of the time on this repository, so
    it is a high bar.
  - Recall is what to improve next, by measuring rather than guessing.
- **Recommendation:**
  - Ship the preset (PRs 1–3 in §7).
  - Run it beside Devin on this repository for a week.
  - Compare the share of each bot's threads that get fixed before merge, and
    only then decide whether to drop Devin.
  - Decisions are in §8.

## 1. What makes a review bot useful rather than noisy

Distilled from the twelve products in §2 (sources in `research.md`):

1. **Silence is a feature.**
   - Copilot posts nothing on 29% of reviews.
   - Bugbot flags 0.4–0.7 bugs a run.
   - Codex's rubric says "prefer outputting no findings".
   - The bots people turn off are the ones that can't stay quiet: Sourcery
     at Cockpit ("about half of the AI reviews were noise"), CodeRabbit's
     56% rejection rate in a 31k-comment study, and Claude Code Review's HN
     complaint that "it will always find about 8 issues".
2. **A finding must clear a concrete bar, with a stated failure.** Codex's
   eight criteria and Anthropic's plugin agree on the bar:
   - this change introduced it;
   - it is one discrete problem;
   - the author would fix it;
   - it rests on no guess about intent;
   - it names the code that breaks, not "may affect other code".
   - Pre-existing issues, lint, types, CI, style, and "consider" phrasing are
     out.
3. **Verify separately from finding.** Anthropic credits "requiring the
   agents to write a proof that their finding is valid" with lifting
   substantive comments from 16% to 54% of PRs. PR-Agent, Ellipsis,
   Graphite and Qodo all run a second pass that scores, validates, or
   judges each finding.
4. **Cap the output.**
   - PR-Agent allows at most 3 findings and "an empty list is acceptable".
   - Claude Code Review's REVIEW.md example allows "at most five nits".
   - Devin posts only bugs and security issues to GitHub; lower-tier
     "flags" stay in its own app.
5. **Remember across pushes, which is where bots get noisy.** What works:
   - read the bot's own earlier threads;
   - never repost one;
   - resolve the threads a push fixed (Claude Code Review, Qodo, Sourcery,
     Bugbot);
   - post nothing on a clean re-review.

   What people hate:
   - Bugbot drip-feeding findings over 5–6 push cycles;
   - flip-flopping, where a later review asks to undo an earlier review's
     fix. Devin did this on #2736 here.
6. **Use the whole repository and the repository's own rules.**
   - Every vendor moved from diff-only to an agent that explores the
     repository, and the ones that run code find more (Greptile's sandbox
     run reports "20% more bugs").
   - Rules come from AGENTS.md, CLAUDE.md and REVIEW.md, scoped to their
     directory.
   - Read the rules from the base branch so a PR can't rewrite its own rules
     (PR-Agent, Bugbot).
7. **Never approve, never request changes.** Claude Code Review, Codex,
   claude-code-action and Devin all post `COMMENT` and leave gating to
   humans, or to a neutral check. Approval is a separate bot with its own
   policy (Dean's later roadmap item).
8. **Measure acted-on, not volume.** The useful metrics are:
   - Bugbot's resolution rate (52% → 80%);
   - Greptile's addressed rate (30% → 66%);
   - Graphite's acceptance rate (target 90%+);
   - Qodo's high-severity acceptance.

   Each is the share of comments the author acted on before merge. They
   reward posting less, so pair them with a recall check: a replay benchmark
   (§6) or GitHub's ReviewBench.
9. **The PR is untrusted input.** Treat the title, body, comments and code as
   data. CodeRabbit's 2025 remote-code-execution incident came from running
   PR code outside the sandbox with the App's private key in reach.
10. **A one-click handoff to a fixing agent.**
    - Bugbot Autofix: "over 35% of Autofix changes are merged".
    - Copilot's "Fix with Copilot", Devin Autofix, and Qodo's remediation
      agent do the same.
    - These need loop limits: Devin documents none, and Cognition says its
      own spend "massively increased".

## 1b. The review bot's settings, modelled on Cursor Bugbot's

Dean: "it should all be configurable in the review bot … check how Cursor
does it". Each Bugbot setting (`research.md` Part E) maps to a trigger
setting of the automation, a line of the review's own settings (the block
its task opens with, which the editor's **Code review settings** section
reads and writes), an existing control, or is skipped. Nothing here needs
an engine of its own.

| Cursor Bugbot setting | Ours | Why |
| --- | --- | --- |
| Per-repository toggle, Enable All, Auto-Enable for New Repositories | The automation's **repositories** | Already there; one automation covers many repositories |
| Run for All Authors / Only Review PRs by… / Skip PRs by… (bots only through this list) | Trigger **From: People ✓ · Luke's agents ✓ · Other bots ☐** | Three classes cover the real cases (Luke's own agents are the ones worth reviewing); a per-login list can follow if asked |
| Enable reviews on draft PRs (off) | Trigger **Skip drafts ✓** | Same default |
| Run Once Per PR / Only Run Once Automatically / triggers.frequency | Trigger **On: Opened ✓ · Ready for review ✓ · New pushes ✓** (untick New pushes for once per PR) | A trigger setting, so any automation can use it |
| Incremental Review (on) | Always: the prompt reads its own earlier reviews by marker and posts only what is new | Built in; there's no reason to turn it off |
| Only Run When Mentioned / manualTriggerOnly / `cursor review` comment | **Skip for now** | Needs an `issue_comment` trigger (a later PR); Run now has no pull request to name |
| (no Bugbot equivalent) fork PRs | Trigger **Include forks ☐** | The run's agent holds a write token |
| Hide "No bugs found" (removed in 2025; API `postSuccessComment`) | Review setting **Comment when no issues are found ✓** | A line of the prompt |
| (no Bugbot equivalent) finding cap | Review setting **At most N findings a review** (5) | A line of the prompt; it's our main noise lever |
| `.cursor/BUGBOT.md` (nested), Team Rules, manual rules with path globs | Review setting **Rules file** (REVIEW.md), read from the base branch beside nested AGENTS.md and CLAUDE.md; team-wide rules go in the editable task | A line of the prompt; nesting comes from the repository's own files |
| Automatically Learn Rules | **Skip** | It would need an engine of its own |
| Autofix: Off / Create New Branch / Commit to Existing Branch | Review setting **Fix what it finds, pushing to the pull request as Luke** (off) | A line of the prompt. Luke's own pushes never re-trigger it, so it can't loop; "new branch" is left out to keep one choice |
| Autofix model, Effort Low/Default/High/Smart | The automation's **model and effort** chip | Already there |
| Post PR Summary / risk score | **Skip** | The review's one-line body is the summary; walkthroughs are the noise the research warns about |
| Fail on unresolved issues (check conclusion) | **Skip** | Needs `checks: write` and a check run; reviews stay `COMMENT` only |
| MCP servers | The agent's own integrations | Already there |
| Spend: on-demand limit / monthly cap | The preset's guards: **5 at once, 50 a day** | Showing them is trivial (the wire and service already take `guards`; it's one row in the editor), but held out since Dean removed Limits |
| `.cursor/config/bugbot.yaml` on the base branch | **Skip**: settings live on the automation | One place to configure; the rules files are already read from the base branch |

## 2. Research table

Every claim is sourced in `research.md`, where every URL was accessed
2026-10-15. "Precision" is each vendor's own measure unless marked.

| Product | Triggers | Context | Output and noise control | Config | Fixes | Cost, latency | Precision measure | Top complaints |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **CodeRabbit** | open; incremental on push; `@coderabbitai review`; label opt-in; auto-pause after 5 commits | sandboxed clone, code graph, 50+ linters, learnings from replies, linked issues, auto-reads AGENTS.md / CLAUDE.md / cursor rules | walkthrough + inline with severity; collapsed nitpicks; profiles chill / assertive; optional request-changes / approve workflow | `.coderabbit.yaml`, path filters and instructions | committable suggestions; `fix comments`; autopilot | $24–72/dev/mo; "within minutes" | Martian online: P 64.9%, R 51.6%; academic: **36% accepted, 56% rejected** | nitpicks, re-raising per push, RCE incident |
| **Greptile** | open / push / rebase; `@greptileai`; label, author, branch filters | repo graph and index, multi-repo, `.greptile/` rules, learns from reactions; sandbox execution (TREX) | summary with confidence score + inline P0/P1/P2; strictness 1–3; status check | `.greptile/config.json`, `rules.md` | "Fix in Claude Code / Cursor / Conductor / Devin" buttons | $30/seat + $1/credit; median 2:25 | **addressed rate 30% → 66%** | noise, overwrote PR descriptions, pricing backlash |
| **Cursor Bugbot** | every update; `bugbot run`; once per PR; mention only | agentic tools over the repo; BUGBOT.md (read from base); learned rules from reactions | inline; resolves stale comments on re-review; neutral check; bugs only | BUGBOT.md, `bugbot.yaml`, effort | **Autofix** in VMs (>35% merged); Fix in Cursor / Web | ~$1–1.50/review; 90% under 3 min | **resolution rate 80%** (LLM-judged at merge) | drip-fed findings, flip-flops, stale hallucinations |
| **GitHub Copilot** | request as reviewer; rulesets for open / ready; optional "review new pushes" | agentic on Actions runners, CodeQL and linters, AGENTS.md + copilot-instructions (from head), MCP, skills | overview + inline High/Med/Low; groups similar comments; COMMENT (approvals opt-in since Sep 2026) | instructions files, effort Lite / Balanced | "Fix with Copilot" opens a stacked PR | $0.05–5 credits + Actions minutes | 71% of reviews have actionable feedback; 29% silent; ReviewBench | repeats dismissed comments, can't see replies, double billing |
| **Devin Review** (used here today) | non-draft open, push, ready; `/devin review` | codebase-aware session; reads REVIEW.md / AGENTS.md / CLAUDE.md / others' configs | one-line body; inline bugs and security only, with a hidden JSON marker per comment; flags stay in its app; minimizes fully resolved reviews | REVIEW.md, trigger rules | Autofix loop on any bot's comments; pre-post self-fix | in Devin plans (ACUs); 1–3 min here | none published; **here: 44 of 47 acted on (94%)** | ACU opacity, flip-flop (#2736 here) |
| **Graphite Agent** (was Diamond) | all new and updated PRs, filters | multi-step Claude pipeline, voting, self-critique, RAG over past PRs | inline, no severity, bugs not style; exclusions as first-class objects | UI prompts, file rules | commit suggestion; Cursor cloud agents | $40/user/mo; ~90 s | **<3% downvoted, 67% implemented** (vendor); 6–18% recall (competitor benchmarks) | low recall |
| **Qodo** / **PR-Agent** (OSS) | open, reopen, ready; push incremental; `/review`, `/improve` | Qodo: multi-agent + judge, PR-history relevance. PR-Agent: diff + dynamic context, AGENTS.md from the default branch, ≤500 lines | persistent comment edited in place; ≤3 findings (PR-Agent); a reflection pass scores 0–10; resolved / outdated strike-through | `.pr_agent.toml` | remediation agent; committable suggestions | ≈$1.67/review (derived); Opus-class ≈$1, P50 144 s | high-severity acceptance rate | "high noise ratios" |
| **Ellipsis** (now an agent cloud) | per push, unseen commits only | YAML of Claude Code / Codex reviewer sessions in VMs | blocking / non-blocking; silent on pass; per-reviewer comment caps | `.ellipsis/code-review.yaml`, per-run $ budget | agent sessions | usage, $2–5 caps | none public | pivoted away from being a bot |
| **Sourcery** | open; every commit (≤5 auto re-reviews); `@sourcery-ai review`, labels | diff + related code, linked issues | summary in the PR body, guide, inline `issue (bug_risk):`; re-review resolves addressed threads | Quiet / Balanced / Verbose, rules | commit suggestion | $12–30/seat; a re-review costs 1/10 | none | "half noise" (Cockpit turned it off) |
| **Claude Code Review** (Anthropic, managed) | once on open / every push / manual; `@claude review [always]` | parallel agents + a verification step; CLAUDE.md (as nits) + REVIEW.md | inline 🔴 Important / 🟡 Nit / 🟣 Pre-existing; neutral check with severity counts; auto-resolves on push mode | REVIEW.md levers: severity, nit cap, skip rules | push a fix | **$15–25 and ~20 min a review** | "<1% of findings marked incorrect" | cost; "always finds about 8 issues" |
| **claude-code-action**, `/code-review` plugin, `/security-review` | workflow on PR events or `@claude` | `gh pr diff` / view, scoped CLAUDE.md; plugin: 4 parallel reviewers then a per-issue validator (earlier: 0–100 score, keep ≥80) | inline comments, suggestions ≤5 lines, "one comment per unique issue"; "No issues found" otherwise | workflow YAML, prompt | `@claude` in interactive mode | API tokens + Actions minutes | none published | comments pile up per push |
| **OpenAI Codex** | `@codex review`; automatic per user; 👀 while running | repo + execution; AGENTS.md "Code Review Rules" closest to the file | COMMENT review; P0–P3 badge + title + one paragraph; "prefer outputting no findings"; sticky summary with hidden state | AGENTS.md sections | `@codex fix the P1 issue` | in plan | **authors change code in 52.7% of commented cases**; >80% positive reactions | coverage depends on each author's toggle |

## 3. What Luke already has

The bot reuses all of this unchanged.

| Piece | Where | What the bot uses it for |
| --- | --- | --- |
| Automations | `packages/service/src/automations/` | trigger → queued run → guards (daily cap, concurrency, pause) → a coding agent started as the creator; run history; "Archive successful runs" |
| GitHub event triggers (#2515) | `automation-github.ts`, the App webhook | a PR delivery becomes a run under GitHub's delivery id (deduped); filters by branch and label; bot senders and `luke/` branches are kept out so automations can't fire themselves; the event is fenced as untrusted data in the task |
| Workspace automations with repositories (#2746) | `automation-store.ts`, `automations-app.ts` | one review automation covers many repositories |
| Coding agents | `coder-host/` | a Vercel sandbox, the repository cloned with full history, shell, files, workers, web search; `gh` and `git` reach GitHub through the firewall as **`luke[bot]`**, on an installation token minted with `contents: write` and `pull_requests: write` (plus CI read) |
| The creator's keys (D3) | `automation-runs.ts` | "the agent runs as the owner on the owner's keys": the creator pays |
| Message the agent | `coder-host/steer.ts` | "fix the P1 on line 162": the same agent, its review in context, pushes a fix |
| Inbox | `post_to_inbox` | used only when the bot couldn't review (the task already says to post only what needs the developer) |

## 4. The recommended design

### 4.1 Shape

A **"Code review" preset** in the automation editor fills in an ordinary
automation (`packages/features/src/automation-code-review.ts`):

- **Trigger:** GitHub event `pull-request-updated` in the chosen
  repositories, with optional branch and label filters. It fires on a pull
  request **opened, reopened, marked ready, or pushed to** (`synchronize`).
  Drafts and bot senders don't fire it.
- **Action:** a coding agent, a new one each run, on the creator's chosen
  model, handed the preset's prompt.
- **Defaults:** archive successful runs on; concurrency 5; daily cap 50
  (D10).

Each push is its own run, deduped by GitHub's delivery id. The run's agent:

1. reads the PR (`gh pr view`, `gh pr checkout`, `gh pr diff`) and what its
   description links to;
2. reads AGENTS.md, CLAUDE.md and REVIEW.md **from the base branch**, scoped
   to the changed paths;
3. reads **its own earlier reviews**, found by a hidden
   `<!-- luke-code-review -->` marker in the review body:
   - it resolves the threads the new commits fixed (`resolveReviewThread`);
   - it leaves unfixed ones alone, and never reposts one;
   - it doesn't repeat what another reviewer said;
4. looks for issues through three lenses, over time, every consumer, and
   boundaries and rules, each handed to a worker on a larger diff. It checks
   every candidate against the bar in §1, with a written failure scenario,
   and keeps at most five, at P0/P1 (P2 only on a first review with nothing
   worse);
5. posts **one** `COMMENT` review through
   `POST /repos/{repo}/pulls/{n}/reviews`:
   - a one-sentence body under the marker;
   - inline comments on lines checked against the diff, each a bold
     severity and title plus one paragraph;
   - a `suggestion` block only when it alone fixes the issue;
   - a clean first review gets a one-line body;
   - a clean re-review gets nothing;
   - a run whose head moved on before posting posts nothing, because the
     newer push's run covers it;
6. ends with one line in its transcript: the review's address and the
   counts.

### 4.2 What is reused, and what is new

**Reused unchanged:** the webhook, delivery dedupe, run guards, the run
history, the coding agent and its sandbox, the App identity and token, the
creator's keys, archive-on-success, message-the-agent, and the Inbox.

**New (all in the draft PR, ~180 lines of logic plus tests):**

1. **`pull-request-updated`** (`automation-github.ts`):
   - One delivery can now be two events: an `opened` is both
     `pull-request-opened` and `pull-request-updated`.
   - Drafts are no update, but `ready_for_review` is.
   - Bot senders are kept out, as for every other event.
2. **Workspace automations hear GitHub events.**
   - The listener matched only automations on a plan, through the plan's
     repository, so #2746 refused a GitHub trigger on a workspace
     automation at create.
   - PATCH still let one through, and that automation then never fired (the
     bug the bot found on main).
   - Now the listener matches any of the automation's own repositories, and
     the owner must still be a member of its workspace; the refusal is gone.
3. **A run starts in the repository the event named,** among the
   automation's repositories, rather than always the first.
4. **The preset:** name, trigger and prompt, as a constant the editor offers.

**Not needed:** a new GitHub permission (`pull_requests: write` is already on
the agent's token, and resolving threads uses the same), a webhook
subscription (the App already receives `pull_request`), a table, a route, a
review store, or any comment-dedupe logic in code.

### 4.3 How it avoids noise with nothing but the prompt

| Lever | How |
| --- | --- |
| The bar | "Post only what the author would want to change before merging"; Codex's criteria; "never invent a finding". |
| Proof | "Try to prove yourself wrong… write down the input or state that makes it fail"; drop "might", "could" and "consider". |
| Scope | Not lint, types, CI, style, naming, or lines the PR didn't change. A missing test only where the repository's rules require one. |
| Caps | At most 5; P2 only on a first review with no P0/P1. |
| Memory | Its own threads found by marker: fixed ones resolved, open ones never reposted, disputed ones left (or one reply). |
| Silence | One line when clean the first time, nothing after; nothing when its head is stale. |
| Rules | Read from the base branch, scoped by directory; a REVIEW.md outranks the defaults, so a repository tunes the bot without touching Luke. |

The one piece of logic in code is the trigger's draft and bot filter. It
decides whether a sandbox starts at all, so the prompt can't make it cheap.

### 4.4 Who pays, and permissions

- **Pays:** the automation's creator, on their provider keys, per D3. This is
  unchanged: the run is a Start as the owner.
- **Cost:** ~$0.25–0.85 of model per review on Opus 5.5 high, plus the
  sandbox's minutes. A repository with 30 pushes a day spends roughly
  $10–25 a day.
- **Guards:** the daily cap and concurrency guard bound it.
- **Permissions:** the App's existing `pull_requests: write`, and
  `contents: write` for a fix. No change to the App's manifest.

### 4.5 How it shows in Luke

- **Automations → Code review → runs:**
  - each push is a run row, started, skipped (cap or concurrency), or
    failed, linking to its agent;
  - the agent's page is its transcript, ending in the review's address.
- **With "Archive successful runs" on,** finished review agents leave the
  agent list. The review lives on GitHub, where the author acts on it.
- **Inbox:** only when the bot couldn't review, for example because the
  checkout failed. Findings don't go to the Inbox; they belong to the PR's
  author, on GitHub (D8).
- **Fix it:**
  - Open the run's agent and say "fix the P1 about the closed PR". It checks
    out the branch, commits and pushes as `luke[bot]`.
  - That push is a bot's `synchronize`, so it fires no new review: no loop.
  - A GitHub-side "@luke fix this" is a later trigger (D9).

### 4.6 Security

- **Fork PRs:**
  - The agent holds a write token at its sandbox's firewall and is told to
    run tests.
  - On a **public** repository, a stranger's fork PR is untrusted code and
    an untrusted prompt in that sandbox.
  - The dormant `pull-request-opened` trigger already has this exposure.
  - Recommend refusing a fork's PR in the trigger, `head.repo` ≠ `base.repo`
    (D4, a few lines), as Claude Code Review does.
- **Prompt injection:**
  - The event fields are fenced and entity-escaped already.
  - The prompt tells the agent to read the title, body, comments and code as
    data.
  - The rules files come from the base branch.
- **Loops:**
  - The bot never pushes unless a developer asks.
  - Its own pushes come from a bot and fire nothing.
  - It never approves.

## 5. Three ways to get a review bot

| | A. Build our own review service | **B. Preset: GitHub trigger + ordinary agent + review prompt** | C. Integrate an existing bot |
| --- | --- | --- | --- |
| What | a dedicated pipeline: parallel finders, a judge, a findings store, our own poster, dedupe in code | what §4 describes | point users at Devin, Bugbot, CodeRabbit, Greptile, Claude Code Review; or call one's API |
| New code | large (M–L: a store, a pipeline, a poster, a UI) | **small (S: ~180 lines + a prompt)** | none, or an integration (S–M) |
| Quality | the most tunable | high precision measured; recall below Devin's, improvable in the prompt and with sampling | Devin: 94% acted on here |
| Uses Luke's agent (full tools, the repository's skills, "message it to fix") | partly | **yes** | no |
| Who pays | the creator's keys | **the creator's keys** | the vendor's seat or credits, outside Luke |
| Lives in Luke (run history, agent page, Inbox) | yes | **yes** | no |
| Matches "simplest possible, reuse what exists" | no | **yes** | yes for us, no for the product |

**Recommend B.**

- A is what B grows into only if measurement shows a single agent can't
  reach the bar. Even then, the step is "the agent hands lenses to workers,
  then verifies", which the prompt already invites, not a new service.
- C costs nothing to build. But Luke's product is the agent: a reviewer that
  can be told "fix it" and that pays from the same keys is the point.
- Users who want C can install those bots today, and Luke doesn't stand in
  their way.

## 6. The spike

### 6.1 What's in the draft PR

- **The trigger, the listener, and the run repository** (§4.2, items 1–3),
  with behavior tests that fail without them:
  - a delivery test proving that opened, pushed, and ready PRs queue a run
    for a workspace automation made from the preset in any of its
    repositories, while a draft, a bot's push, and a close queue none, and
    an opened PR fires both an opened and an updated automation;
  - a run test proving the agent starts in the event's repository when it
    isn't the automation's first;
  - the create API now accepting a GitHub trigger on a workspace automation.
- **The preset** with the final prompt.
- **This document,** the research, the results, the harness, and the visual.

**Rough edges:**

- The listener's SQL matches a JSON array with `jsonb_array_elements_text`,
  without an index on repositories. That's fine at today's scale (it filters
  on `trigger_kind` first).
- The preset has no UI. The automation editor doesn't exist yet, and the
  preset is a constant it will offer.
- The prompt was tuned on one repository.

### 6.2 What was demonstrated, and how well

All numbers are in `results.md`.

- **Live, on [#2751](https://github.com/ReviewStage/luke/pull/2751), a throwaway draft:**
  - The first review found all 4 planted bugs and nothing else.
  - After a push fixing two, it resolved exactly those two threads and posted
    nothing.
  - After a push fixing a third and planting a regression under a "this is
    deliberate" comment, it resolved the third, **missed the regression**,
    and stayed quiet.
  - Posted from Dean's `gh`, labelled so, because this sandbox holds no App
    key.
- **Dry runs on 5 merged PRs:** 4 clean, and 1 real bug that shipped (#2746's
  PATCH gap, fixed by this spike).
- **Replays against Devin on 7 PRs:**
  - v1 found 4 of Devin's 14 findings + 2 real new ones.
  - The final prompt found **6 of 14 + 3 real new ones**, including a bug
    still on main (#2741's Home Inbox mismatch).
  - Across all variants, Devin had 7 findings none of ours matched.
- **Precision: 36 comments, 0 wrong, 0 nitpicks.**
- **Cost: $0.24–0.83, 38–152 s.**

### 6.3 What it says

- The shape works end to end with no bespoke logic.
- The prompt is precise.
- Recall is the gap. The misses are mostly state going stale over time, and
  stated intent respected too readily.
- Runs vary: the same commit drew 2 findings in one sample and 1 in another.
  Two cheap levers to try next, measured on the replay set before adopting:
  - make the lens workers mandatory on diffs over N files;
  - run two finders and verify the union.

## 7. PR plan

Sizes: S = under ~300 lines with tests, M = under ~800.

1. **S, ready in the draft PR:** `pull-request-updated`; workspace
   automations heard through their repositories; the run starts in the
   event's repository; create accepts GitHub triggers on workspace
   automations. Tests as in §6.1.
2. **S:** fork PRs refused by the trigger (D4), plus luke[bot]'s own PRs
   reviewed once on open or ready (D3), if decided.
3. **S:** the preset constant with the final prompt and its default guards
   (archive on, concurrency 5, cap 50). It ships with PR 4, so knip has its
   consumer.
4. **M, on the automation editor (roadmap step 11):** the GitHub event
   trigger's UI (event, repositories, branch and label filters) and a "Code
   review" preset card that fills it in. The prompt shows in the editor,
   editable.
5. **S, measurement:** a `tools/` command that reads `luke[bot]`'s review
   threads on a repository and reports the share resolved after a commit
   touched their lines (the addressed rate), beside Devin's. The replay
   harness moves there too, as the prompt's regression benchmark.
6. **Later, M each:**
   - an `@luke review` / `@luke fix this` mention trigger
     (`issue_comment` / `pull_request_review_comment` deliveries);
   - per-PR supersede, where a newer push cancels an older run of the same
     PR instead of competing for concurrency;
   - a neutral check run carrying severity counts, if a gate is wanted (it
     needs `checks: write`).

## 8. Decisions for Dean

1. **Shape: B, an automation preset on an ordinary agent.** Recommend yes.
   Not a bespoke service, and not "use Devin" as the product answer.
2. **Trigger: a new `pull-request-updated` event** (opened, reopened, ready,
   pushed; drafts skipped) rather than letting one trigger list several
   events, which would be a wire change. Recommend yes.
3. **Review Luke's own agents' PRs?**
   - Today the bot-sender rule skips them, because the App opens them as
     `luke[bot]`, and they are the PRs most in need of review.
   - Recommend firing on luke[bot]'s *opened* and *ready* only, never its
     pushes, so a fix can't loop. This is a small exception in the trigger.
   - The alternative is to keep skipping them and let the coding agent
     self-review before it publishes.
4. **Fork PRs:** refuse in the trigger when the head repository isn't the
   base. Recommend yes; it applies to `pull-request-opened` too.
5. **Never approve or request changes; always `COMMENT`.** Recommend yes.
   Approval is the auto-approve bot's, with its own policy.
6. **Noise defaults:**
   - at most 5 findings;
   - P0/P1, with P2 only on a first review with nothing worse;
   - a one-line "no issues" on a clean first review;
   - silence on a clean re-review.

   Recommend as is; a repository tunes it with REVIEW.md.
7. **Where the instructions live:** in the automation's prompt (visible,
   editable), with repository specifics in REVIEW.md or AGENTS.md read from
   the base branch. Recommend no built-in Luke skill and no hidden prompt.
8. **Findings stay on GitHub, not in the Inbox;** the Inbox only when the bot
   couldn't review. Archive successful runs on by default. Recommend yes.
9. **Fix flow for v1:** message the run's agent in Luke. "@luke fix this" on
   GitHub comes later (§7.6). Recommend yes.
10. **Guards:**
    - The preset defaults to concurrency 5 and a daily cap of 50.
    - Known gap: a push that arrives while the automation is at its
      concurrency limit is *skipped*, not queued, and with several PRs
      active at once a review can be missed.
    - Recommend accepting this for v1 (skips show in the run history) and
      doing per-PR supersede later.
11. **Trial:** run it on this repository beside Devin Review for a week, then
    compare addressed rates (§7.5) before deciding on Devin. Recommend yes.
12. **Model:** the creator's chosen model and effort. The spike measured Opus
    5.5 high; nothing is pinned in the preset. Recommend yes.
13. **Follow-ups the bot found on main:**
    - Home's Inbox lists teammates' items for a plan that holds one of
      yours, and omits a plan that holds only theirs (from #2741).
    - The PATCH gap from #2746, which PR 1 closes.

    Recommend filing the Home Inbox one as its own fix.

## 9. Open questions

- **Can a GitHub App's `APPROVE` count toward required reviews?** Sources
  conflict. It matters for the auto-approve bot, not this one; test it with
  the Luke App.
- **The real eve runtime vs the harness.** The task text, the model, and `gh`
  match; the agent loop and the tool names differ. The first real run on PR
  1's deploy should be compared with a harness run on the same PR.
- **A repository that already runs another review bot.** Step 3 tells the
  bot not to repeat other reviewers' points; the dedupe against Devin's
  comments wasn't measured.
