# Proposal: use Luke on a repository without the GitHub App, with a classic personal access token

Status: **proposed; nothing built.** The decisions in §9 wait on the
developer.

> "I ideally want any engineer at any company to do full self serve without
> getting permission from anybody." … "I think we should do a classic
> personal access token, let's plan that out."

## Summary

- **What it is.** A member pastes a classic personal access token (scope
  `repo`) in Settings › Integrations › GitHub. Every repository that token
  reaches becomes usable for *that member's own* tasks and coding agents,
  without the GitHub App installed. The App stays the full, team-wide path;
  a repository the workspace's installation reaches never uses a token.
- **Why classic.** It is the one GitHub credential an org does not gate by
  default: fine-grained tokens need owner approval by default, an OAuth App
  is blocked by default in new orgs, and the App needs an owner or a repo
  admin. An org that has restricted classic tokens still refuses them (a
  403), and Luke says so rather than working around it.
- **What a token-mode task gives up.** No webhooks, so agents are woken by a
  poller in the minute sweep rather than at once (§6). No bot identity, so
  commits, pull requests, and comments are the member's (§5). No
  GitHub-event automations (§7). Only the token's owner can open a terminal
  in, steer, or fork a token-mode agent, because the sandbox carries their
  credential (§4).
- **The credential is held tightly.** Sealed like the provider API keys
  (AES-256-GCM, versioned key ring, §2), never handed to the Mac, a trace, or
  an answer, and put at the sandbox's firewall only on paths under the one
  repository, so even a prompt-injected agent cannot use it on the member's
  other repositories (§4.1).
- **Size: six PRs**, roughly 2,500–3,500 lines with tests (§8).

## 1. The token

- **Kind and scope.** Classic only (`ghp_…`). The scope asked is `repo`,
  which is what the App's write token covers today (contents, pull requests,
  checks, statuses, actions read). `workflow` is not asked: the App does not
  grant workflow writes either, so an agent cannot push a change under
  `.github/workflows/` in either mode. A fine-grained token (`github_pat_…`)
  is refused at save with a line saying why; accepting one is a later
  change (§9.2).
- **Creating it.** The settings row links to
  `https://github.com/settings/tokens/new?description=Luke&scopes=repo`,
  which opens GitHub's form with the note and scope filled in. The row
  suggests a 90-day expiry; GitHub lets the member choose none.
- **Checking it at save.** One `GET https://api.github.com/user` with the
  token:
  - 401 → refused, "GitHub did not accept this token."
  - `X-OAuth-Scopes` without `repo` → refused, naming the missing scope.
  - The `github-authentication-token-expiration` header, where present, is
    stored as `expires_at`.
  - The login and id are stored. A token whose GitHub user is not the one the
    member signed in to Luke with is refused: a member's token is theirs, and
    it keeps commits and pull requests attributed to the person who asked.
- **SAML single sign-on.** An org with SSO answers 403 with an `X-GitHub-SSO`
  header naming the URL where the member authorizes the token for that org.
  The member does this themselves, no admin needed. Luke shows that link as
  the failure's remedy (§3).

## 2. Storage

A new table, `github_personal_token`, one row per user, copying
`account_provider_key`:

| Column | |
| --- | --- |
| `user_id` | primary key, cascades on user delete |
| `key_version`, `sealed_data_key`, `sealed_token` | as `provider-key-seal.ts` seals them |
| `hint` | the last four characters, for the row to show |
| `github_user_id`, `github_login` | from `GET /user` at save |
| `expires_at` | nullable |
| `status`, `status_at` | `verified`, `invalid` (a 401 since), `unreadable` (the seal fails) |

- **Seal.** `packages/database/src/models/provider-key-seal.ts` is reused by
  making its purpose string a parameter (`luke/github-token/*` beside
  `luke/provider-key/*`), keyed by the same `PROVIDER_KEY_ENCRYPTION_KEYS`
  ring. `scripts/rewrap-provider-keys.sh` rewraps both tables. The GitHub
  sign-in token's seal under `BETTER_AUTH_SECRET` is not reused: that key
  cannot rotate.
- **Endpoint.** `GET/PUT/DELETE /api/github/token`
  (`HOSTED_SERVICE_PATH.GITHUB_TOKEN`), shaped like
  `provider-keys-app.ts`: bearer, byte cap, 10 saves an hour, and every
  answer a summary (`login`, `hint`, `status`, `expiresAt`), never the
  token. Route file `apps/web/server/routes/github/token.ts`.
- **Delete.** Removes the row. Running token-mode agents fail their next
  GitHub step with the `GITHUB_TOKEN` remedy (§3). Luke does not revoke the
  token on GitHub; the row says to delete it there too.

## 3. Failures and what the member sees

- **A 401 anywhere** marks the row `invalid` and fails the step with a new
  `FAILURE_REASON.GITHUB_TOKEN`, labelled "Update GitHub token", opening
  Settings › Integrations › GitHub, as `API_KEY` opens API keys.
- **A 403 with `X-GitHub-SSO`** fails with "Authorize your token for
  <org>", linking GitHub's URL from the header.
- **A 403 from an org that restricts classic tokens** fails with "<org>
  doesn't allow personal access tokens" and offers the App install, which is
  the org's own path.
- **Expiry.** Seven days before `expires_at`, the row and the repo picker
  say when it ends.
- `REPOSITORY_UNREACHED` gains token reasons beside the installation ones:
  `TOKEN_MISSING`, `TOKEN_INVALID`, `TOKEN_NO_ACCESS`, `TOKEN_NO_PUSH`.

## 4. Where the token is used

### 4.1 Reach

Reach is `reach(organizationId, fullName)` in `github-app.ts:1263`, fresh
from GitHub on every check, and every token mint goes through it. The seam:

- `reach` takes the acting member (`actor: userId`). The installation path
  runs first, unchanged. Where it finds no installation reaching the
  repository and the actor holds a verified token, it reads
  `GET /repos/{owner}/{name}` on the token and answers
  `{ access: { kind: "member-token", userId }, repository }`, with
  `permissions.push` saying whether the member may write.
- `ReachKey` and `TokenKey` gain the actor, so a cached reach or token never
  crosses members.
- The token methods (`repositoryReadToken`, `repositoryWriteToken`, …) hand
  back the member's token for a `member-token` reach instead of minting.
  `repositoryCiReadable` answers true for one (`repo` covers CI reads).
- Every caller that already knows the member passes them (start, steer,
  tasks-app, automations, task-tools, published, repository-shell, checkout,
  the picker and the file/tree/skills/PR/issue routes). The ones with no
  member today (`reachTaskRepository` and its file, tree, and skills
  callers, `repositorySkills`, `factory-world`) take the task's owner.
- **The repo picker** (`GET /api/github/repositories`) adds the member's
  `GET /user/repos?affiliation=owner,collaborator,organization_member&sort=updated`
  to the installation's list. A repository on both is listed once, as the
  App's. Each entry gains `access: "app" | "token"`, and the picker marks
  token ones "Only you".

### 4.2 Who may act on a token-mode agent

The sandbox belongs to the workspace today: any member can open a terminal
in it, steer it, or fork it (`agentReachableBy`,
`workspace-store.ts:533`), and the terminal relay mints with the agent
owner's identity (`terminal/production.ts:103`). With the owner's token at
the firewall, that would hand their credential to every member. So for an
agent whose reach is `member-token`:

- **Terminal**: only `agent.userId` may open one
  (`agent-terminals-app.ts` `reachedSession`, `terminal/production.ts`
  `reach`).
- **Fork and continue**: only the owner (`snapshot.ts` `copySourceWork`).
- **Steer, chat, `message_agent`**: the owner and the owner's own Luke.
  Another member's message is refused with "Only <name> can direct this
  agent; it works through their GitHub token."
- **Reading** the transcript, plan, and pull request stays open to the
  workspace, as now.

### 4.3 The coding agent's sandbox

- **Firewall, scoped to one repository.** Today eve's `authenticateGitHub`
  puts the token on every request to `github.com` and `api.github.com`.
  Token mode writes its own policy, as `cloneNetworkPolicy` in
  `repository-shell.ts` already does for the clone, with the header only on:
  - `github.com` paths under `/{owner}/{name}.git/` (git), and
  - `api.github.com` paths under `/repos/{owner}/{name}/` and the exact
    path `/repos/{owner}/{name}` (REST).
  Requests anywhere else, including the member's other repositories, go out
  with no credential. That keeps a prompt-injected agent from using the
  token beyond the repository it was given.
- **The cost of scoping: no GraphQL.** `api.github.com/graphql` cannot be
  scoped to a repository, so it gets no header. `gh pr checks` and `gh pr
  view` use GraphQL and fail. The instructions for a token-mode agent swap
  them for REST through `gh api repos/{owner}/{name}/…` (check runs,
  statuses, reviews, comments, marking ready). See §9.3 for the alternative.
- **Withdrawal.** An installation token expires within the hour; a classic
  token may never expire. So the policy is set back to `allow-all` (no
  header) explicitly at turn end, at stop, and when the terminal relay
  closes, and set again at the next turn's start
  (`apps/dev/hooks/store.ts`, `agent-runtime/sandbox.ts`,
  `terminal/relay.ts`). Renewal at 50 minutes is skipped for a token.
- **The planner's read checkout** (`repository-shell.ts:426`) uses the token
  the same way the installation's read token is used now: on the clone's
  path alone, and withdrawn after it.

## 5. Identity

- **Commits** are authored as the member: the name and noreply email from
  `GET /user`, with Luke's co-author trailer, as `DEVELOPER` authors are
  today. `readAuthor` gains `TOKEN` as a reason, so the row says how it was
  settled.
- **The pull request** is opened with the token. There is no App fallback,
  since there is no App.
- **Comments and reviews the agent posts** come from the member's login, the
  same login a human reply from them would have. The webhook's
  `byLuke = login === botLogin` test cannot tell them apart. §6.2 settles it.

## 6. Waking agents without webhooks

### 6.1 The poller

A new sweep, `token-pull-request-sweep`, runs in the minute cron
(`/api/maintenance/sweep`, 60 s shared with the other sweeps).

- **What it polls.** Each published, open pull request of an unarchived
  token-mode agent: its PR, check runs and status for the head SHA, reviews,
  and issue comments. That is 5 REST reads per PR, each conditional on the
  ETag stored from the last poll, plus one for a new review's inline
  comments.
- **Cost.** A `304 Not Modified` does not count against GitHub's 5,000
  requests an hour, so a quiet PR costs nothing. A changed one costs its
  reads. The limit is per user, shared with the member's own use of their
  token elsewhere, so the sweep reads `X-RateLimit-Remaining` and skips a
  member below 500.
- **Cadence.** Every minute while the agent is working or for two hours after
  its last activity on the PR, then every ten minutes, then hourly after a
  day quiet. Capped at a fixed number of PRs per sweep (as `automation-sweep`
  caps its runs) and claimed under a row lock, since Vercel may call one
  minute twice.
- **What it calls.** The webhook's own functions, so behaviour matches:
  `agentPublished` for the published state, and `wakeAgents` with an
  `AgentWake` it builds. In place of the delivery id, each wake carries a
  stable key (`review:<id>`, `comment:<id>`, `check:<sha>:<conclusion>`,
  `status:<sha>:<context>:<state>`), which `steer.ts`'s `sentLineStands`
  already dedupes on.
- **What it stores.** A new table, `token_pull_request_poll`: agent id, PR
  number, the ETag per read, the highest review and comment id seen, the head
  SHA and check conclusion last seen, and `next_poll_at`.

### 6.2 Telling the agent's comments from the member's

A token-mode comment by the member's login counts as the agent's when it was
created while the agent's turn was running (between the turn's start and its
`settledAt`). Otherwise it is the member's, and wakes the agent as a human
reply does now. Two cases this gets wrong, both rare and both harmless:

- The member comments on GitHub while the agent is mid-turn. It is treated as
  the agent's and does not wake it; the agent reads it when it next reads the
  PR, and the member can say it in Luke instead.
- An agent comment that GitHub stamps just after the turn settles wakes the
  agent once, on its own words. The wake's text names the author, so the
  agent sees it is its own and ends the turn.

## 7. What token mode does not cover

- **Automations triggered by GitHub events** (PR opened, label, failed check
  suite, push) need App deliveries and stay App-only. An automation on a
  schedule or a webhook is App-only too in the first version, since it runs
  as no member; naming a member whose token it runs on is §9.5.
- **Agents started by automations** are written as the App
  (`checkout.ts:108`) and stay so.
- **Repos for teammates.** A token reaches what its owner reaches. A
  teammate needs their own token, or the App.

## 8. The PRs

1. **The token row** (~500 lines): table and migration, the seal's purpose
   parameter, the rewrap, `/api/github/token`, the save checks of §1, and the
   settings row (a password field like `api-keys-section.tsx`, the prefilled
   GitHub link, hint, status, Remove). `PRIVACY.md` gains a paragraph
   matching its API-key promises.
2. **Reach and the picker** (~700): the actor through `reach` and every
   caller, the `member-token` access, the picker merge and its "Only you"
   mark, the new `REPOSITORY_UNREACHED` reasons. Behind the experimental
   setting, so nothing is reachable by token until PR 3 lands.
3. **The coding agent in token mode** (~800): the scoped firewall policy and
   its withdrawal, `TOKEN` author, PR opening on the token, the REST-only
   instructions, and the owner-only gates of §4.2.
4. **The planner and file reads** (~300): the read checkout, tree, skills,
   task file, and issue reads on the token.
5. **The poller** (~700): the sweep, `token_pull_request_poll`, ETags, the
   cadence, and the turn-window rule of §6.2.
6. **Failures and docs** (~300): `FAILURE_REASON.GITHUB_TOKEN`, the SSO and
   org-restriction remedies, the expiry warning, and the docs saying what
   shipped.

Rollout: behind an experimental setting until PR 5 lands, then on for
everyone, with the App still offered first where a member can install it.

## 9. Decisions

Each has a recommendation; the plan above assumes it.

1. **Precedence.** *Recommended:* the App first, the token only where no
   installation reaches the repository. Alternative: let the member choose
   per task. Costs a control nobody asked for.
2. **Fine-grained tokens.** *Recommended:* refuse in the first version, so
   there is one scope check and one set of failures. A fine-grained token is
   safer, and many members could use one on their personal repos, so it is a
   small follow-up once this ships.
3. **Firewall scope.** *Recommended:* scoped to the one repository, no
   GraphQL (§4.3). Alternative: the whole of `api.github.com`, which keeps
   `gh pr checks` working but lets the agent use the token on every
   repository the member reaches.
4. **Who may steer a token-mode agent.** *Recommended:* the owner only
   (§4.2). Alternative: any member may message it, but the terminal and fork
   stay the owner's. A message can still make the agent run commands with the
   owner's credential, so this is weaker than it looks.
5. **Automations on a member's token.** *Recommended:* not in this plan.
   Alternative: an automation names the member whose token it runs as, which
   needs their consent at creation and a rule for when they leave.
6. **Polling cadence.** *Recommended:* §6.1's (1 min active, 10 min after two
   hours, hourly after a day). Faster costs nothing on quiet PRs but crowds
   the 60-second sweep.

## 10. Risks

- **A stored token reaches everything its owner reaches**, unlike an
  installation token scoped to one repository for an hour. The seal, the
  scoped firewall, the owner-only gates, and never handing it out are the
  defence. A leak of the database and the key ring together would expose
  every member's token; this is the same exposure as the API keys today.
- **GitHub's own guidance** is that personal access tokens are for acting as
  yourself and an App is for long-lived integrations. Token mode is exactly
  acting as yourself: one member, their own tasks, their own attribution. It
  stops being that if a token is ever used for another member's work, which
  §4.2 forbids.
- **Org policy.** An org that later restricts classic tokens turns token mode
  off for its repositories at once. Luke's failure says so and offers the App;
  nothing tries another route.
- **Secondary rate limits.** A burst of pushes and API calls from one member's
  agents can trip GitHub's secondary limit, which pauses that member's token
  for everything. The poller backs off on a 403 or 429 carrying
  `Retry-After`.
