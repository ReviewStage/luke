# Proposal: more than one repository per automation and agent

Status: research for Dean, written 2026-10-14 against main at `d4c5477e`.
It is a sibling of `automations-scope.md`, and it changes only the column
shape in that plan's expand migrations.

Dean's ask:

> "I think we might want to think about supporting multiple repositories for
> automations/agents. They should be able to pull from many sources."

## TL;DR

- **Multi-repo runs are common but not universal.**
  - Cursor (since 2026-05-13), Devin, Codex cloud (since 2026-09-29),
    Claude Code (sessions and Routines), Factory, Warp/Oz, and Ona let one
    run see several repositories.
  - Copilot ("cannot make changes across multiple repositories in one run"),
    Jules, Replit, Linear coding sessions, and Conductor Cloud are one repo
    per run.
- **Everyone draws it the same way.**
  - The repository set lives on a saved config: an environment (Cursor,
    Codex, Factory, Warp), the routine itself (Claude Code), or one org-wide
    image (Devin).
  - The repositories are cloned side by side, one directory each.
  - Each changed repository gets **its own branch and pull request**. No
    product documents linking or ordering those pull requests.
  - Auth is **one GitHub App installation per org**. Cross-org is mostly
    undocumented.
- **Luke assumes one repository everywhere**: one `text` column per plan and
  agent, one installation per workspace, one clone at `/workspace/repository`,
  and one token, branch, and pull request per agent.
- **R: make the columns list-shaped now, and build full multi-repo later.**
  - Now, in the scope plan's two expand migrations: `repositories` (an
    ordered list whose first entry is where the agent starts) on
    `automation` and on `coding_agent`, written with one entry. The wire
    carries `repositories: string[]` with a bound of one. That is about S
    on top of the plan, with no extra PRs.
  - Later, full multi-repo is about 6–8 PRs (M/L): sibling checkouts, one
    token for the set, a branch and pull request per repository, Changes
    grouped by repository, and file references that name their repository.
    The bound lifts without another migration.
  - Cross-org (several installations per workspace) stays out of scope (L).

## 1. Research (all URLs accessed 2026-10-14)

| Product | How repos are chosen | Sandbox layout | Pull requests | Auth | Limits | Picker |
| --- | --- | --- | --- | --- | --- | --- |
| **Cursor** | A multi-repo environment, reused by runs and automations "that use the same repo group". An automation picks no repo, one repo, or such an environment. A PR trigger infers its repo. [setup](https://cursor.com/docs/cloud-agent/setup), [changelog 05-13-26](https://cursor.com/changelog/05-13-26), [automations](https://cursor.com/docs/cloud-agent/automations) | "clones each selected repo"; the layout is not documented | Opened "in the repos it changes"; linking is not documented. [cloud agent](https://cursor.com/docs/cloud-agent) | One App install, all or selected repos. [github](https://cursor.com/docs/integrations/github) | The API's `repos` takes at most 300. [api](https://cursor.com/docs/cloud-agent/api/endpoints) | Select one or more repositories on the environment form |
| **Devin** | One org-wide snapshot holds every configured repo; a session selects repos or @-mentions them. A GitHub trigger names one repo. [blueprints](https://docs.devin.ai/onboard-devin/environment/blueprints), [first run](https://docs.devin.ai/get-started/first-run), [automations](https://docs.devin.ai/product-guides/automations) | `~/repos/<repo-name>`, overridable | Cross-repo work splits into child sessions, each with its own PR. [advanced](https://docs.devin.ai/work-with-devin/advanced-capabilities) | One org connection, all or selected repos. [gh](https://docs.devin.ai/integrations/gh) | At most 10 concurrent clones per build | A repo selector, plus @-mention chips |
| **Codex cloud** | Per environment ("Select the GitHub repositories to check out"); a task picks an environment. [cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environments) | Not documented | Not documented for several repos | The connected GitHub app; multi-org is not documented | Not documented | A "Select repositories" modal with search and an "N selected" count. [cloud](https://learn.chatgpt.com/docs/cloud) |
| **Claude Code** | Per session or routine: "Add one or more GitHub repositories", each "cloned on every run". [routines](https://code.claude.com/docs/en/routines), [web quickstart](https://code.claude.com/docs/en/web-quickstart) | The session "starts above the clones" and loads each repo's CLAUDE.md, but not its hooks. [settings](https://code.claude.com/docs/en/settings) | Projects: "a thread per repository, each with its own pull request". [projects](https://code.claude.com/docs/en/claude-projects) | The App installed per account or org; the proxy blocks repos not attached | Not documented | A repo selector under the input, with a branch picker on each |
| **Copilot** | One repo per task: it "cannot make changes across multiple repositories in one run". [about](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent) | One checkout | One PR in that repo | MCP plus a PAT or App to read other repos. [mcp](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/extend-cloud-agent-with-mcp) | 59-minute sessions | Repo and branch dropdowns |
| **Jules** | One repo per task (or none). [running tasks](https://jules.google/docs/running-tasks/) | A fresh VM | One branch or PR | The Jules App, all or selected repos | 15–300 tasks a day | A repo dropdown, then a branch dropdown |
| **Factory** | Per environment, up to 200 repos. [create](https://docs.factory.com/environments/create.md) | A snapshot with every repo, each with its own setup script; directory names must differ. [run droids](https://docs.factory.com/environments/run-droids.md) | PR links attached back to the Linear issue; per-repo PRs are not documented | Personal plus org GitHub, and App grants per repo | 200 repos | "Add repository", then multi-select |
| **Warp/Oz** | Per environment, "one or more" repos; a GitHub trigger adds its own repo. [environments](https://docs.warp.dev/platform/environments/configuring-environments.md) | A container that "clones every repo configured" | Listed in the run summary | One App installation per org | Not documented | A multi-select on create |
| **Ona** | One project repo; more are cloned through devcontainer or config. [multi-repo](https://ona.com/docs/ona/configuration/multi-repository.md) | `/workspaces/<repo-name>` | Pushed per repo by hand | Per-user OAuth or a PAT | By plan | None (config files only) |
| **Replit, Linear, Conductor** | One repo per import, environment, or workspace. Conductor links others locally with `/add-dir`. [linear](https://linear.app/docs/coding-sessions), [conductor](https://www.conductor.build/docs/tips/using-multiple-repos) | One repo | One PR | — | — | — |

**"Many sources" beyond repos.** Every product attaches non-repo context
as its own kind, never as a repository:
- MCP connectors (all of them);
- knowledge, memories, or skills (Devin, Jules, Cursor, Claude);
- files and drives (Claude Projects: `/mnt/project-files` and Google Drive;
  Devin: @Files);
- wikis (Factory AutoWiki, Devin DeepWiki).

Luke already has MCP integrations and skills. Docs sites and files are a
separate "sources" decision, not part of multi-repo.

## 2. Luke today (inventory at `d4c5477e`)

- **Data:**
  - `plan.repository` is nullable `text` (`owner/name`). It is copied onto
    `coding_agent.repository`, which is `text not null`, beside one
    `branch` and one `published` PR (`schemas/coding-agent.ts:103-113`).
  - There is no repository id anywhere.
  - The automation reaches its repository through the plan on main.
- **GitHub:**
  - There is one installation per workspace (`github_installation`, keyed
    on the organization), and a repository outside the installation's
    account is refused (`github-app.ts:981-996`). Cross-org is therefore
    impossible today.
  - Several repositories inside the org are already reachable.
  - The token mint already sends a *list*
    (`repositories: [name]`, `github-app.ts:998-1013`), so one token can
    cover several repositories of the installation.
- **Sandbox:**
  - One clone at `/workspace/repository`, with one marker file; the
    checkout `rm -rf`s on a different repository (`repository-shell.ts:97-183`).
  - The firewall injects auth only on `/<repo>.git/` paths.
  - There is no disk bound in our code, and sandboxes have 4 vCPU for 24 h.
- **Pull requests and Changes:** one PR per agent (`published.ts:56-132`),
  and Changes lists one PR's files (`coding-agents-app.ts:692-712`).
- **Files:**
  - `/api/plans/{id}/file` reads the plan's repository.
  - `CodeRef` has no repository field.
  - Inbox code blocks carry `repo`, but they are read through the plan's.
- **Unaffected:** `run_on_mac` and public research.

## 3. What a list of repositories changes

| Area | Size | Change |
| --- | --- | --- |
| Schema and stores | M | `repositories` lists on agent and automation (and plan, if wanted), a backfill, the webhook lookup with `= ANY`, and pins |
| Wire and validation | S–M | `repositories: string[]`, each checked against the installation |
| Sandbox checkout | M | `/workspace/<owner>/<name>` per repository, a marker per repository, one token for the list, firewall paths per repository, and re-mints of the set. The agent starts in the first |
| Branches and pull requests | L | `branch` and `published` become one entry per repository. `published.ts`, the webhook, the PR chip, and the plan card read the set; the agent opens one PR per changed repository |
| Changes tab | M | One section per repository's PR |
| Files and @-mentions | M | `CodeRef` gains `repository`, file reads take a repository, @-mentions show `owner/name:path`, and Inbox code reads by `block.repo` |
| Planner tools | M | `run_in_repository` and `show_code` take a repository |
| Desktop pickers | M | The repository chip becomes a multi-select with "starts here" on the first |
| Skills | S | The union of all repositories' skills, prefixed by repository |
| Cost and disk | S | N full clones per sandbox, on Vercel's disk limit; a bound on N (Cursor publishes 300) |
| Cross-org | L | Several installations per workspace; **out of scope** |

## 4. Does it change the automations plan?

**Only the column shape. Do it now, so nothing migrates twice.**

- **`automation.repositories`**, an ordered jsonb list of `owner/name`,
  replaces the planned scalar `repository` in expand migration 1. It is
  backfilled as `[plan.repository]`.
- **`coding_agent.repositories`** joins expand migration 2, backfilled as
  `[repository]`.
  - `coding_agent.repository` stays as the first entry for every reader
    (checkout, token, branch, PR, Changes, files, skills) until full
    multi-repo moves them. The contract step drops it then.
  - `plan.repository` stays scalar. A plan's repository feeds the brain's
    research tools, which is a separate surface, and it can go list-shaped
    in its own expand when wanted.
- **The wire** carries `repositories: string[]` with a bound of one in v1,
  plus one picker ("Repositories", one chip, with "Add repository" shown
  disabled with "More than one is coming").
- **Planless agents** are built single-repo on the list-shaped column, so
  the planless rework doesn't grow.
- **Full multi-repo** comes after the planless rework, as about 6–8 PRs (M/L):
  1. sibling checkout and a list token;
  2. one branch and PR per repository;
  3. Changes by repository;
  4. files, `CodeRef`, and @-mentions with a repository;
  5. planner tools;
  6. the multi-select picker;
  7. skills;
  8. lifting the bound.

  There is no environment object. The automation, or the agent's start,
  is the saved repository set, as Claude Code Routines treat it.
