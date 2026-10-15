# Research: scheduled and triggered agents ("automations")

Status: research for Dean's ask, written 2026-10-14 against main at
`eb6b13de`. The backend it recommends ships as the stacked PRs in §6; the
designs and the UI follow them.

Dean's ask: "I want to add a scheduled/routines/automations feature. Kick off
agents based on a schedule and also based on certain triggers."

## TL;DR

- **The category has converged.** Cursor Automations (March 2026), Devin
  Automations, Claude Code Routines, Copilot Automations (June 2026), Codex
  Scheduled tasks, Factory, Warp and Linear Loops (July 2026) all ship the
  same object: **one prompt + one repository + one or more triggers + a
  run-as identity**, with a list page, a detail page with run history, an
  on/off switch and **Run now**.
- **Schedules:** presets in the UI (hourly, daily, weekdays, weekly) with cron
  or RRULE behind them. The products that store an **IANA time zone per
  schedule** follow daylight saving time correctly. Those that store UTC
  (Factory, Claude's API, Devin's API) drift by an hour twice a year.
- **Events:** GitHub pull request and issue events filtered by label or
  branch, failed CI, Slack messages, Linear issue changes, Sentry and
  PagerDuty alerts, and a generic webhook. The secret is shown once, sent in
  a header, and can be rotated.
- **Guards that matter:**
  - skip a firing while the previous run is still going;
  - an hourly or daily cap per automation;
  - dedupe each delivery by its id;
  - auto-pause after repeated failures;
  - treat the event payload as untrusted input to the agent.

  Real per-run spend caps are rare: only Devin, Replit and `claude -p`
  have them.
- **Recommended v1 for Luke:**
  - An automation belongs to the account and starts **a coding agent on one
    of its plans** (that plan's repository), with a prompt and an optional
    model/effort.
  - Triggers:
    - a **schedule** (cron + IANA zone, with presets), fired by the
      existing minute sweep, claim-once;
    - **GitHub events** from the Luke GitHub App's existing webhook (PR
      opened or labelled, issue opened or labelled, checks failed, push);
    - a **generic webhook** (bearer secret, hashed at rest).
  - Guards: max concurrent runs (skip, default 1), a daily cap (default 10),
    per-delivery dedupe, a 15-minute schedule floor, and auto-pause after 3
    failed starts in a row.
  - Every firing is a run row. The agent's questions already land in the
    Inbox, and the finished-agent notification is reused.
  - Linear, Slack and Sentry through Vercel Connect triggers come next,
    after we verify how Connect signs what it forwards.

## 1. Method

I read each vendor's docs and changelog on 2026-10-14. Every claim cites a URL.
Where a page was gone, I used a Wayback Machine snapshot and say so. "Not
documented" means the vendor's own pages don't say.

Two products have changed shape since the brief was written:

- **Relay.app shut down in September 2026** ([relay.app](https://relay.app/)).
  Its notes below come from archived docs.
- **Sweep** has left the category: it now builds a JetBrains assistant
  ([repo](https://github.com/sweepai/sweep)).

## 2. Coding-agent products

### Cursor: Automations, Cloud Agents, Bugbot

Cursor launched Automations on 2026-03-05 as "always-on cloud agents that run
based on triggers and instructions you define"
([changelog](https://cursor.com/changelog/03-05-26)).

- **Schedule:**
  - A preset or a cron expression. Runs "may run with a delay but will not
    start before the indicated time"
    ([docs](https://cursor.com/docs/cloud-agent/automations)).
  - Time zones are not documented.
  - One forum report describes hourly runs skipped after a stuck run left a
    stale record
    ([forum](https://forum.cursor.com/t/cursor-automations-stopped-running-on-hourly-schedule/155679)).
- **Triggers:** several per automation, any of which fires it.
  - Source control (GitHub, GitLab, Bitbucket): PR opened, pushed or merged,
    push to branch, comment, CI completed.
  - Slack: channel message, reaction, channel created.
  - Linear: issue created, status changed, end of cycle.
  - Sentry, PagerDuty, and a private webhook with an API key shown after
    saving ([docs](https://cursor.com/docs/cloud-agent/automations)).
  - Outside Automations, `@cursor` in Slack, Linear or a PR comment starts an
    agent, with inline `repo=`/`branch=`/`model=` options
    ([Slack](https://cursor.com/docs/integrations/slack)).
- **What runs:**
  - A prompt against no repository, one, or a multi-repo environment, with a
    chosen model.
  - Tools are enabled per automation: create PR (on by default), comment,
    Slack, MCP, computer use, memories. The docs warn that memories should be
    used "with caution if your automation handles untrusted input".
- **Concurrency and dedupe:** not documented for Automations. In the API, one
  run is active per agent, and a follow-up during a run is `409 agent_busy`
  ([API](https://cursor.com/docs/cloud-agent/api/endpoints)).
- **History and notifications:**
  - Not documented for Automations.
  - Agents started from Slack report ⏳/✅/❌ and a PR link.
  - The v1 API's status webhooks are "coming soon"
    ([webhooks](https://cursor.com/docs/cloud-agent/api/webhooks)).
- **Pause, edit, test:** "save and activate"; admins can disable
  ([help](https://cursor.com/help/ai-features/automations)). Run now is not
  documented.
- **Cost guards:**
  - Runs are "billed at API pricing for the selected model" against the
    team's spend limit
    ([help](https://cursor.com/help/ai-features/automations),
    [cloud agents](https://cursor.com/docs/cloud-agent)).
  - Bugbot autofix is capped at 3 attempts per PR, and its trigger API at
    30 requests a minute per team ([Bugbot](https://cursor.com/docs/bugbot)).
- **Permissions:**
  - "Run as" is **Me** (your bill, your GitHub identity) or a **Service
    account** (the team pool, PRs as `cursor`; admins only).
  - Visibility: Private, Members can view, or Members can edit
    ([docs](https://cursor.com/docs/cloud-agent/automations)).
- **UI:**
  - cursor.com/automations and the Agents Window.
  - Create flow: trigger → prompt → tools → repository → save and activate.
  - `/automate` drafts an automation from plain language.
  - Cursor's own managed agents (Bugbot, Security, PR Routing) sit on the
    same page.

### Devin (Cognition): Automations, playbooks

"Schedules is a legacy feature"; scheduling now lives in Automations
([legacy](https://docs.devin.ai/product-guides/scheduled-sessions.md)).

- **Schedule:**
  - Presets (hourly, daily, weekly, once, every N units), stored as
    **iCalendar RRULE**.
  - "Each schedule has its own time zone, which defaults to your browser's
    time zone" and follows daylight saving
    ([automations](https://docs.devin.ai/product-guides/automations.md)).
  - The API evaluates RRULEs in UTC
    ([API](https://docs.devin.ai/api-reference/common-flows.md)).
- **Triggers:** any of several, each filterable
  ([automations](https://docs.devin.ai/product-guides/automations.md)).
  - Slack message, mention or reaction.
  - GitHub issue, comment, PR, review, check run or push, with filters such
    as `conclusion = failure`.
  - GitLab pipeline.
  - Linear created, labelled, status or assigned.
  - Jira, PagerDuty, schedule, and a webhook with a regex filter.
  - Linear triggers "fire on change, not on state"
    ([Linear](https://docs.devin.ai/integrations/linear.md)).
- **What runs:**
  - Start a session with the prompt, the event appended, and an `@playbook`.
  - Or message an existing session, triage a channel, or send an email.
  - An optional **Preflight** script decides `run: false` or one session per
    item ([automations](https://docs.devin.ai/product-guides/automations.md)).
  - Playbooks are reusable prompts with Procedure, Specifications, Advice,
    Forbidden Actions and Required from User sections
    ([playbooks](https://docs.devin.ai/product-guides/creating-playbooks.md)).
- **Concurrency and dedupe:**
  - Every match runs at once by default.
  - **Queueing** sets "Concurrent runs" and "Queue depth", and events beyond
    the queue are dropped.
  - Preflight dedupes items by `id`.
- **History and notifications:**
  - An **Activity** tab lists each invocation (success or skip, session link,
    error).
  - The list shows a 30-day sparkline.
  - Email on Always, On failure, or On success.
- **Pause, edit, test:**
  - An on/off toggle.
  - **Run now**, which skips Preflight.
  - Preflight "Test against" runs without actions.
  - Legacy schedules went to an "Error" state after repeated failures
    ([legacy](https://docs.devin.ai/product-guides/scheduled-sessions.md)).
- **Cost guards:**
  - A per-session maximum in ACUs (Agent Compute Units).
  - A per-automation **rate limit**, 50 runs an hour by default.
  - Enterprise caps per user and per organization
    ([usage](https://docs.devin.ai/enterprise/features/usage-policies.md)).
- **Permissions:** organization or creator run-as. Secrets are selected per
  automation, and only those are injected.
- **UI:**
  - An Automations sidebar entry.
  - Create from scratch, from about 24 templates, or "Generate with Devin".
  - The editor sections: trigger, Preflight, actions, limits, queueing,
    connections.
  - "Schedule Devin" from any session.

### OpenAI Codex: Scheduled tasks, cloud tasks

The feature once called Automations appears as **Scheduled tasks** in the
ChatGPT/Codex desktop app
([docs](https://learn.chatgpt.com/docs/automations.md?surface=app)).

- **Schedule:** presets plus custom controls and an editable **RFC 5545
  RRULE**. Time zones are not documented.
- **Triggers:**
  - GitHub PR activity, filterable by author, title or label.
  - Slack channel messages.
  - Gmail.
  - "One task can use multiple event triggers, but it can't combine event
    triggers with a time-based schedule"
    ([codex automations](https://learn.chatgpt.com/codex/automations)).
  - Cloud tasks also start from `@codex` on GitHub, Slack and Linear, where a
    triage rule can auto-assign
    ([Linear](https://learn.chatgpt.com/docs/third-party/linear)).
- **What runs:**
  - A saved prompt with skills and connectors, on a model and effort.
  - A **standalone** task opens a fresh chat; an **in-chat** task returns to
    the same chat.
  - Team Tasks run in the cloud on a service account.
- **Concurrency and dedupe:** "ChatGPT may combine [close events] in one run".
- **History and notifications:** "The **Scheduled** view acts as your inbox",
  with unread markers.
- **Pause, edit, test:** active, paused or completed; **Run now**. The docs
  advise testing the prompt in a chat first.
- **Cost guards:** not documented.
- **Permissions:**
  - Runs are unattended under the default sandbox, with
    `approval_policy = "never"`.
  - Admins gate event triggers with a permission.
- **UI:** a Scheduled sidebar entry holding the inbox and the task list. Tasks
  are created by asking in chat.

### GitHub Copilot cloud agent, and GitHub Actions

**Copilot Automations** shipped 2026-06-02
([changelog](https://github.blog/changelog/2026-06-02-schedule-and-automate-tasks-with-copilot-cloud-agent/)).

- **Schedule:** hourly, daily or weekly in the cloud. Cron only for local
  automations, with a plain-language preview
  ([app](https://docs.github.com/en/copilot/how-tos/github-copilot-app/using-automations)).
- **Triggers:**
  - Issue created, filtered by a search query.
  - PR opened or synchronized, filtered by search and changed files.
  - Manual.
  - Assigning an issue to Copilot also starts the agent, from GitHub, Slack,
    Teams, Jira or Linear
    ([create](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/create-automations),
    [Linear](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/integrate-cloud-agent-with-linear)).
- **What runs:**
  - A prompt, a model, and a **tools allowlist** (push, labels, create PR) on
    one repository.
  - A session is capped at 59 minutes
    ([about](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent)).
- **Concurrency and dedupe:** not documented.
- **History:** the Automations pane lists the sessions each automation started.
- **Pause, edit, test:** disable, edit, delete, **Run now**, and **Create and
  run**.
- **Cost guards:** "billed to the user who created the automation"; no
  per-automation cap.
- **Permissions:**
  - Automations are private to their creator.
  - A repository setting allows triggers only from users with write access.
- **UI:**
  - Repository Agents tab → Automations → Create new.
  - Cards show name, schedule, repository, last run, and a play button.

**GitHub Actions**
([events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)):

- **Schedule:**
  - Five-field cron, UTC unless the newer `timezone:` key is set, every
    5 minutes at most.
  - Runs "can be delayed during periods of high loads" and may be dropped.
  - Scheduled workflows in a public repository are disabled after 60 days
    without activity
    ([disable](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows)).
- **Concurrency:** one running and one pending run per group, with
  `cancel-in-progress` or `queue: max`
  ([concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)).
- **Test runs:** `workflow_dispatch` with typed inputs.

### Claude Code: Routines, Desktop scheduled tasks, the GitHub Action

**Routines** are "a prompt, one or more repositories, and a set of connectors,
packaged once and run automatically"
([routines](https://code.claude.com/docs/en/routines)).

- **Schedule:**
  - Presets: hourly, daily, weekdays, weekly, once.
  - Times are entered in local time and converted to UTC.
  - Custom cron via `/schedule update`.
  - **Minimum interval of one hour.**
  - The docs suggest :07 rather than :00 to avoid top-of-hour delays.
- **Triggers:**
  - A schedule.
  - An **API** endpoint (`POST …/fire` with a per-routine bearer token, shown
    once and regenerable).
  - GitHub `pull_request` and `release` events, filtered by author, title,
    branch, labels, draft or merged, with operators down to regex.
- **What runs:**
  - A full autonomous session, cloned from the default branch or the PR head,
    pushing only `claude/` branches.
  - Fire text arrives inside a `<routine-fire-payload>` block marked
    **untrusted**.
- **Concurrency and dedupe:** every event is its own session. Events beyond
  the hourly caps "are dropped".
- **History:**
  - Each past run opens as its session.
  - "A green status… does not mean the task in your prompt succeeded."
- **Pause, edit, test:**
  - On/off, edit, delete, **Run now** with optional text.
  - Runs are skipped while GitHub is disconnected, and the routine turns off
    after 72 hours of that.
- **Cost guards:** hourly caps of 100 scheduled runs per account, 30 fires per
  routine, and 100 API fires per account, with no overage.
- **Permissions:** routines belong to their creator and act as that person.
- **UI:** claude.ai/code/routines (list → New routine: name, prompt, model,
  repositories, environment, trigger, connectors), the Desktop Routines
  sidebar, and `/schedule`.
- **Desktop local tasks**
  ([desktop](https://code.claude.com/docs/en/desktop-scheduled-tasks)):
  - A few minutes' stagger.
  - **One catch-up run** for the latest miss.
  - History shows skipped runs with the reason ("asleep", "previous run
    still going").
- **claude-code-action and `claude -p`:**
  - Scheduled `on: schedule` workflows.
  - `--max-turns`, `--max-budget-usd`, and GitHub concurrency as the
    documented cost guards
    ([actions](https://code.claude.com/docs/en/github-actions),
    [headless](https://code.claude.com/docs/en/headless)).

### Conductor: routines

Routines arrived in Conductor 0.85.0 (2026-09-09): "run your agents on a
schedule or via GitHub action"
([changelog](https://www.conductor.build/changelog/0.85.0-sections-routines-and-a-new-model-picker)).

- **Schedule:** Hourly, Daily, Weekly and Weekdays presets
  ([0.87.0](https://www.conductor.build/changelog/0.87.0-search-across-files-opencode-2-0)).
  Time zones and cron are not documented.
- **Triggers:**
  - Schedule, GitHub, and a webhook.
  - PR triggers filter on label, author and base branch with is / is not.
  - The API creates exactly one webhook trigger
    ([API](https://www.conductor.build/docs/api)).
- **What runs:**
  - A saved prompt in a fresh workspace on the default branch, with agent,
    model and effort.
  - The webhook answers 202, and "the JSON body is attached to the prompt".
- **Concurrency, dedupe, cost guards:** not documented.
- **Pause, edit:**
  - `enabled`; a disabled routine's URL answers 409.
  - `conductor routine create|list|rotate-secret`.
  - No get, update or delete endpoint.
- **Permissions:**
  - Routines run "with that user's Git and agent credentials".
  - The webhook URL is the credential, rotated with `rotate-secret`.
- **UI:** a routine with its prompt and completed runs (the changelog
  screenshot).

### Google Jules, Factory, Warp, Amp, Replit, Sweep

**Jules**
([scheduled tasks](https://jules.google/docs/scheduled-tasks/),
[limits](https://jules.google/docs/usage-limits/)):

- **Schedule:** frequency and cadence from a dropdown; no cron or zone
  documented.
- **Triggers:** a schedule, or a `jules` label on a GitHub issue.
- **What runs:** a prompt against a repository and branch.
- **History:** only last and next run.
- **Pause, edit:** editing "is not currently supported"; you delete and
  recreate.
- **Cost guards:** daily caps over a rolling 24 hours (Free 15 tasks and 3 at
  once, Pro 100 and 15).

**Factory**
([automations](https://docs.factory.com/web/automations.md)):

- **Schedule:**
  - Plain language or cron, but "cron expressions run in UTC" and
    plain-language zones are frozen to UTC, so **daylight saving is not
    followed**.
  - A run that doesn't start within 15 minutes is recorded as missed.
- **Triggers:**
  - Slack, with channel patterns and keyword filters.
  - GitHub, through Actions.
  - A webhook with a regex filter.
- **Concurrency and dedupe:**
  - Identical webhook bodies are deduped within 10 minutes.
  - Webhooks are capped at 10 runs an hour.
  - A delivery is **skipped while the previous run is in progress**.
- **History and notifications:**
  - An Events feed and a 7-day success rate.
  - Statuses: Active, Paused, Degraded, Failed.
  - Email on the first urgent failure, then a daily digest.
- **Pause, edit, test:**
  - Pause and resume, Run now, a curl test for webhooks.
  - **Auto-pause after 5 consecutive scheduled failures.**
- **Permissions:** webhook secrets are shown once and stored hashed. "Run as"
  can't be changed after creation.

**Warp**
([scheduled agents](https://docs.warp.dev/agent-platform/cloud-agents/triggers/scheduled-agents),
[factory automations](https://docs.warp.dev/factories/automations.md)):

- **Schedule:** five-field cron (UTC per a third-party mirror).
- **Triggers:** Slack, Teams, GitHub (branches, paths, labels, authors,
  workflow conclusions), GitLab, Linear, Jira and webhooks. Bot events are
  skipped by default.
- **Runs:** "One event can match more than one automation, and each match
  starts its own run."
- **Pause, edit, test:**
  - **Test filter** against stored deliveries.
  - A "Recent deliveries" log that shows rejected and deduplicated events.
- **UI:** the schedules list has Name, Schedule, Paused, Last Ran and Next Run
  columns.
- **Cost guards:** credits; runs stop at zero.

**Amp**
([automations](https://ampcode.com/docs/orbs/automations),
[event-driven orbs](https://ampcode.com/news/event-driven-orbs)):

- **Schedule:** natural language only, one schedule per thread, waking the
  same thread.
- **Triggers:**
  - GitHub (signature-verified, deduplicated), Linear, and HTTP.
  - Event content is "untrusted input, not agent instructions".
- **Failures:** "If a run fails, Amp pauses the automation and shows the
  error."

**Replit**
([routines](https://docs.replit.com/core-concepts/agent/agents-and-automations)):

- **Schedule:** hourly, daily or weekly, minimum one hour, in the device's
  zone.
- **Concurrency:** "Replit does not add another pending run for the same
  Routine."
- **Cost guards:** a **per-run budget** checked after each step.

**Sweep:** no longer in this category (above).

## 3. Workflow and automation platforms

### Linear: Loops, triage rules, agent delegation

**Loops** (2026-07-20) are Linear's automations: a plain-language job Linear
Agent runs on a schedule or an event
([changelog](https://linear.app/changelog/2026-07-20-introducing-loops),
[docs](https://linear.app/docs/loops)).

- **Schedule:** hourly to yearly, with a chosen zone and first run; several
  days a week allowed.
- **Triggers:**
  - Issue, project, initiative, cycle and release events, with up to 8
    conditions.
  - Triage loops are team-only.
- **What runs:** Linear Agent with optional MCP connectors and Slack; it can
  start coding sessions that open draft PRs.
- **Dedupe:** a loop "won't run again on later updates while the same
  conditions still match".
- **History and notifications:** **Run history**, with follow-up questions to
  the agent, and a notification on failure.
- **Pause, edit, test:** right-click Enable/Disable, **Run now**.
- **Cost guards:**
  - AI credits; **loops pause when credits run out**.
  - Limits: 100 loops per team, 500 per workspace.
- **Permissions:**
  - Edit rights per loop.
  - Toggles for web access, coding sessions, and "allow changes outside
    triggering entity".
- **UI:** a Loops sidebar group and team tab. Create flow: trigger →
  instructions → connectors → scope review → Create loop.

Older automations sit beside Loops:

- Triage rules (conditions → set team, status, assignee, labels)
  ([triage](https://linear.app/docs/triage)).
- SLAs, recurring issues
  ([recurring](https://linear.app/docs/creating-issues)).
- Git branch and PR status rules
  ([github](https://linear.app/docs/github)).

Agent delegation sets an agent as an issue's `delegate`. Linear then sends
`AgentSessionEvent` webhooks, which the agent must acknowledge within 5 s and
answer with an activity within 10 s
([agent interaction](https://linear.app/developers/agent-interaction)).

Linear webhooks
([webhooks](https://linear.app/developers/webhooks)):

- Each delivery carries a `Linear-Delivery` id.
- `Linear-Signature` is an HMAC of the body, and `webhookTimestamp` should be
  within about 60 s.
- Failed deliveries are retried at roughly 1 minute, 1 hour and 6 hours.

### Slack Workflow Builder

- **Schedule:** date, time and frequency in the UI. The API takes a
  `timezone`
  ([scheduled triggers](https://docs.slack.dev/tools/deno-slack-sdk/guides/creating-scheduled-triggers)).
- **Triggers:**
  - Link, webhook, schedule, list item, keyword message, member joined,
    reaction
    ([help](https://slack.com/help/articles/17542172840595-Build-a-workflow--Create-a-workflow-in-Slack)).
  - Webhook triggers are limited to 1 request a second, and "the URL itself
    is the only credential"
    ([help](https://slack.com/help/articles/360041352714-Build-a-workflow--Create-a-workflow-that-starts-outside-of-Slack)).
- **History:** an activity log of runs and steps, kept 90 days
  ([help](https://slack.com/help/articles/360055655493-View-workflow-activity-logs)).
- **Pause, test:** Unpublish is the pause, and there is no test-run button
  ([help](https://slack.com/help/articles/360054495774-Edit-and-manage-your-workflows)).
- **Permissions:** connector steps run on the builder's account by default.

### Zapier

- **Schedule:**
  - Polling every 15 minutes (Free) down to 1 minute (Team)
    ([pricing](https://zapier.com/pricing)).
  - Schedule by Zapier uses the **account's** zone
    ([help](https://help.zapier.com/hc/en-us/articles/8496288648461)).
- **Dedupe:** a polling trigger dedupes on each item's `id`
  ([platform](https://platform.zapier.com/build/deduplication)).
- **Flood protection:** a trigger that brings in more than 100 records at once
  holds the runs until you confirm by email
  ([help](https://help.zapier.com/hc/en-us/articles/8496181445261-Set-up-your-Zap-trigger)).
- **History:**
  - Runs are success, filtered, held, stopped, or errored.
  - Autoreplay retries a failed step up to 5 times over about 10.5 hours
    ([history](https://help.zapier.com/hc/en-us/articles/8496291148685-View-and-manage-your-Zap-history),
    [errors](https://help.zapier.com/hc/en-us/articles/14167175792909-Decide-how-your-Zap-handles-errors-with-advanced-settings)).
  - A Zap erroring on 95% of more than 20 runs in a week is **turned off**
    ([help](https://help.zapier.com/hc/en-us/articles/8496216132621-Zap-is-not-running)).
- **Cost guards:** pay-per-task, with a hard stop at 3× the plan
  ([help](https://help.zapier.com/hc/en-us/articles/15279018245901)).
- **Test runs:** testing an action step is live and really changes data in
  the connected app.

### Make

- **Schedule:** regular intervals, daily, weekdays, monthly, on demand
  ([help](https://help.make.com/schedule-a-scenario)).
- **Concurrency:**
  - Webhook triggers default to 100 runs a minute, and the rest queue.
  - "Sequential processing" runs one at a time
    ([settings](https://help.make.com/scenario-settings)).
- **History:** a History tab with operations and credits per run, plus
  stored **incomplete executions** for retry
  ([history](https://help.make.com/scenario-history),
  [incomplete](https://help.make.com/incomplete-executions)).
- **Failures:** "Number of consecutive errors" deactivates a scenario, and an
  instant trigger's scenario deactivates on its first error.
- **Cost guards:** scenarios stop when credits run out.

### n8n

- **Schedule:**
  - Intervals or cron, in the **workflow's** zone, else the instance's
    ([schedule](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.scheduletrigger/)).
  - The **durable scheduler** keeps upcoming runs in the database. Each run is
    claimed by one instance so it fires once.
  - Missed runs follow a misfire policy (skip by default; or run the latest
    missed) with a 1-minute grace
    ([durable scheduler](https://docs.n8n.io/deploy/host-n8n/configure-n8n/durable-scheduler)).
- **Webhooks:** a test URL and a production URL, header/JWT/basic auth
  ([webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/)).
- **Concurrency:** an optional production concurrency limit that queues the
  excess
  ([concurrency](https://docs.n8n.io/hosting/scaling/concurrency-control/)).
- **History and failures:** an executions list with retry, and an **error
  workflow** per workflow
  ([executions](https://docs.n8n.io/workflows/executions/all-executions),
  [errors](https://docs.n8n.io/flow-logic/error-handling/)).

### Lindy and Relay.app

**Lindy** (classic builder, archived; current Routines
[docs](https://docs.lindy.ai/teammate/routines.md)):

- **Schedule:** "every weekday at 9 AM"-style triggers.
- **Webhooks:** an optional bearer secret, "only shown once"
  ([archived](https://web.archive.org/web/20260512181056/https://docs.lindy.ai/skills/by-lindy/webhooks.md)).
- **History:** a Tasks view shows each run step by step, with email on error.
- **Test runs:** a dry run "fires the routine on real data" but writes
  nothing.
- **Cost guards:** credits. A task drawing far more than usual pauses and asks
  whether to continue
  ([usage](https://docs.lindy.ai/account-billing/usage.md)).

**Relay.app** (defunct; archived
[triggers](https://web.archive.org/web/20260818020145/https://docs.relay.app/triggers/triggers-101)):

- **Webhooks:** a `relayDeduplicationKey` in a payload means a repeat starts
  nothing.
- **Failures:** repeated trigger errors email the owner, then turn the trigger
  off.
- **History:** runs are grouped as Pending, Running, Issues, Action required,
  Waiting and Completed.
- **Pause:** "Freeze all runs" is the emergency stop.
- **Human-in-the-loop:** approval steps over Slack and email.

### Vercel Cron and Vercel Connect triggers

**Vercel Cron** ([overview](https://vercel.com/docs/cron-jobs),
[manage](https://vercel.com/docs/cron-jobs/manage-cron-jobs)):

- **Schedule:**
  - Five-field cron, **UTC only**, a GET to the production deployment.
  - Once a minute at best on Pro.
- **Delivery and history:**
  - Delivery is best effort: a run can be missed, and **"the same scheduled
    run can be invoked more than once"**.
  - Nothing is retried, and there is no run history beyond the function logs.
- **Auth:** `CRON_SECRET` arrives as the bearer.
- **For Luke:** this is the minute sweep Luke already runs. The automation
  schedule must be idempotent over it.

**Vercel Connect triggers**
([triggers](https://vercel.com/docs/connect/concepts/triggers),
[CLI](https://vercel.com/docs/cli/connect)):

- **Setup:**
  - `vercel connect create <service> --triggers --trigger-event <EVENT>`
    subscribes a connector to its provider's webhooks.
  - `--trigger-path` is a flag of **`vercel connect attach`**, not `create`.
    It names the project path Connect forwards each event to.
- **Events:**
  - Linear's defaults are Comment and Issue
    ([Linear](https://vercel.com/connect/linear)).
  - GitHub's page names `pull_request`
    ([GitHub](https://vercel.com/connect/github)).
  - Slack is also inbound.
- **Signing:**
  - Connect checks the provider's signature, then re-attests the event with
    the deployment's **OIDC identity**
    ([GA changelog](https://vercel.com/changelog/vercel-connect-ga),
    [Chat SDK](https://vercel.com/docs/connect/frameworks/chat-sdk)).
  - The forwarding header is not named in the docs.
- **Delivery:**
  - 5xx answers are retried up to three times.
  - There is no delivery dedupe: "make every handler idempotent".
- **Cost:** Pro bills $0.95 per 1,000 triggers
  ([pricing](https://vercel.com/docs/connect/pricing)).

### Webhook delivery references

**GitHub**
([validating](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries),
[best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks),
[failed](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries)):

- `X-Hub-Signature-256` is an HMAC of the body, with no timestamp.
- Answer within **10 s** or the delivery counts as failed.
- `X-GitHub-Delivery` is the dedupe key and stays the same on a redelivery.
- GitHub "does not automatically redeliver failed webhook deliveries".

**Stripe** ([webhooks](https://docs.stripe.com/webhooks)):

- An HMAC over `timestamp.body` with a 5-minute tolerance.
- Two secrets are valid during a roll.
- Retries for three days.

**Standard Webhooks**
([spec](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md)):

- Signed `webhook-id.timestamp.body`, with `webhook-id` as the idempotency
  key.

## 4. Side by side

| Product | Schedule | Zone | Events | Overlap | Caps | Auto-pause | Run now |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Cursor | presets + cron | ? | GitHub, Slack, Linear, Sentry, PagerDuty, webhook | ? | team spend limit | – | ? |
| Devin | presets + RRULE | IANA per schedule (UI) | GitHub, GitLab, Slack, Linear, Jira, PagerDuty, webhook | run all, or queue + drop | 50/h, ACU per session | legacy "Error" | yes |
| Codex | presets + RRULE | ? | GitHub PR, Slack, Gmail | may batch | – | – | yes |
| Copilot | hourly/daily/weekly | ? | issue, PR | ? | billed to creator | – | yes |
| Claude Routines | presets, ≥1 h | local → UTC | GitHub PR/release, API | none | 100/h account, 30/h routine | after 72 h without GitHub | yes |
| Conductor | presets | ? | GitHub PR, webhook | ? | ? | – | ? |
| Factory | NL + cron | UTC (no DST) | Slack, GitHub, webhook | skip while running | 10/h webhook | 5 failures | yes |
| Warp | cron | UTC? | many | each match runs | credits | – | yes |
| Linear Loops | presets | chosen | Linear entities | no re-fire while matching | credits | when credits run out | yes |
| n8n | intervals + cron | workflow's | webhook, apps | optional limit + queue | executions/month | – | yes |
| Zapier | presets | account's | apps, webhook | flood hold at 100 | tasks, 3× hard cap | 95% errors | poll now |

## 5. Synthesis

### The patterns that matter

1. **An automation is a saved Start.**
   - Every product stores what a person would have typed to start an agent:
     prompt, repository, model, tools. A trigger then replays it.
   - Luke already has exactly this call: `startCodingAgent` with a `task`,
     which the voice brain already makes "as the deployment acting for the
     account" (`coder-host/start.ts`, `coder-host/channel.ts`). An automation
     run is that call from the sweep or a webhook.
2. **Presets over cron, with the zone stored.**
   - Show Hourly / Daily / Weekdays / Weekly with a time, and keep cron as
     the advanced field.
   - Store an IANA zone per automation and show "Next run: Mon 09:00".
   - UTC-only storage (Factory, Claude's API) breaks "9am" twice a year.
3. **Every firing is a row, including the ones that did nothing.**
   - Devin's Activity tab, Claude Desktop's skipped runs with reasons, and
     Warp's "Recent deliveries" all answer "why didn't it run?"
   - "Started" is not "succeeded" (Claude says so outright), so the run links
     to the agent, and the agent's own status is the outcome.
4. **Guards: skip, cap, dedupe, pause.**
   - Skip while the previous run is going (Factory, Replit).
   - Cap per automation (Devin 50/h, Claude 30/h, Jules daily).
   - Dedupe on the delivery id (GitHub's `X-GitHub-Delivery`, Linear's
     `Linear-Delivery`, Relay's dedupe key).
   - Auto-pause after repeated failures (Factory 5, Make N, Amp 1, Zapier
     95%).
5. **The payload is untrusted.**
   - Claude wraps fire text in a marked block, Amp labels event content
     "untrusted input", and Cursor warns about memories.
   - An issue title is attacker-controlled text, so it reaches the agent as
     data under the developer's instructions, never as instructions.

### Pitfalls

- **Runaway loops.** An agent opens a PR, which fires "PR opened", which
  starts an agent that opens a PR.
  - Warp skips bot events by default.
  - Luke should ignore deliveries whose sender is the Luke App itself, or a
    `luke/` branch an automation's own agent pushed. It should also hold every
    automation to its concurrency and daily caps, so a loop burns at most the
    cap.
- **Duplicate runs.** Vercel Cron may invoke the same minute twice, GitHub
  redelivers by hand, and Connect retries 5xx.
  - Dedupe in the database: one run per automation and firing key (the due
    instant, or the delivery id), enforced by a unique index rather than
    application logic.
- **Noisy triggers.**
  - "Every push" on a busy repository, or "every new issue" during a spam
    wave, is Zapier's flood problem.
  - The answer is filters (label, branch), the daily cap, and making the cap
    visible as skipped runs, rather than queueing work forever (Devin drops
    beyond its queue depth).
- **Missed and late schedules.**
  - A down sweep, a deploy, or a paused automation leaves a backlog.
  - Fire one coalesced catch-up run within a grace window and skip anything
    staler (n8n's misfire policy, Claude Desktop's single catch-up). Never
    replay a backlog.
- **Cost.**
  - Every run is a coding agent: a sandbox for up to 24 hours plus model
    tokens on the account's key or Luke's.
  - A minute's cron would start 1,440 agents a day, so floor schedules at
    15 minutes (Claude and Replit floor at 1 hour, GitHub at 5 minutes) and
    cap runs per day.
- **Credentials drift.**
  - The automation runs as its maker: their GitHub App token, provider keys
    and integrations.
  - When those lapse, runs fail with a fixed reason, and after three in a row
    the automation pauses itself (Claude turns a routine off after 72 hours
    without GitHub).

### Recommended v1 for Luke

**The model.**

- An `automation` belongs to an account and one of its plans: name,
  enabled/paused, trigger, action, guards.
  - The action is a coding agent on the plan's repository, handed the prompt
    as its task, with an optional model/effort (else the account's default).
  - Its questions land in the Inbox as any agent's do, and its end raises the
    existing agent-finished notification.
- An `automation_run` records each firing:
  - what fired it (due instant, GitHub event summary, webhook size, manual);
  - its status (queued, started, skipped, failed);
  - a fixed reason word;
  - the agent it started;
  - when it fired and settled.
- The agent's own status is read through the agent, never copied.

**Triggers in v1.**

1. **Schedule:**
   - Five-field cron + IANA zone, with presets Hourly, Daily 09:00,
     Weekdays 09:00 and Weekly Mon 09:00, and a 15-minute floor.
   - The minute sweep claims due rows with `FOR UPDATE SKIP LOCKED`, moves
     `next_run_at` on, and records the run under the due instant, so a double
     invocation records one run.
   - Misfires older than an hour are skipped, not replayed.
2. **GitHub:**
   - Through the Luke App's existing webhook (`POST /api/github/webhook`,
     already signed and verified).
   - Events: PR opened, PR labelled, issue opened, issue labelled, check
     suite failed, push.
   - Filters: labels, branches.
   - Scope: the plan's repository.
   - Dedupe: `X-GitHub-Delivery`.
   - Deliveries the App itself caused are ignored.
3. **Webhook:**
   - `POST /api/automations/webhook?id=…` with `Authorization: Bearer
     <secret>`.
   - The secret is shown once, kept as its SHA-256, and rotatable.
   - An `Idempotency-Key` header dedupes.
   - The JSON body reaches the agent inside a block marked untrusted.
   - This covers Sentry, PagerDuty and anything else with outbound webhooks
     until native triggers exist.

**Guards in v1.**

- Max concurrent runs: 1–5, default 1. A firing past it is **skipped**, not
  queued.
- Daily cap: 1–50 runs in a rolling 24 hours, default 10. Skipped past it.
- Dedupe per firing key.
- Auto-pause after **3 failed starts in a row**, with the reason shown.
- Bot-loop protection on GitHub events.

**Test run.** "Run now" records a manual firing through the same guards and
start path.

**Next, after v1.**

- **Linear, Slack and Sentry as native triggers through Vercel Connect**
  (`vercel connect create linear --triggers --trigger-event Issue`, then
  `vercel connect attach … --trigger-path /api/automations/connect`). This
  waits on confirming the forwarded request's OIDC attestation header, which
  the docs don't name. The generic webhook covers Sentry meanwhile.
- **A planning turn as an action.** The planning channel admits the
  deployment for spoken turns only today, so a typed automation turn is a new
  admission to review on its own.
- **Workspace-shared automations** and service-account run-as.
- **Per-run spend caps.** Luke meters spend per account, not per run, today.

**Where it lives in the app.**

- A top-level **Automations** entry in the sidebar, as Devin, Codex and Linear
  do. It holds:
  - a list (name, trigger summary, next run, last run's result, switch);
  - a create/edit sheet;
  - a detail view with run history, where each run links to its agent tab.
- §6's design phase proposes the options.

## 6. The backend as stacked PRs

1. This document, the wire vocabulary, the `automation` and `automation_run`
   tables, and the store with PGlite tests.
2. The schedule engine: cron + zone reading, the 15-minute floor, the next due
   instant across daylight saving, and the sweep's claim-once.
3. Run execution: guards, the start through `startCodingAgent` as the
   deployment acting for the account, run settling, auto-pause.
4. The HTTP API: CRUD, Run now, run history, wire schemas in
   `@luke/features`.
5. GitHub App webhook triggers.
6. The generic signed webhook (then Connect triggers).
7. Desktop host and gateway plumbing, then the UI.
