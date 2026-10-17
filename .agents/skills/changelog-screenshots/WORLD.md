# The screenshot world

Every release's pictures happen in one invented company, so a reader paging
through the changelog sees one team's work go on rather than a new set of
strangers each time. Keep what is here; add to it. A new release brings new
plans, agents, and pull requests for whatever it shows, written into this
world and recorded below when they are worth keeping. The source of truth
for 0.12.0's data is `staging/shots/`; this file is the part that should
outlive any one release's code.

## Brand

- **The organisation is acme.** Its GitHub owner picture is
  `assets/acme-mark.svg`: two peaks, white and `#99f6e4`, on teal `#0f766e`,
  full bleed (the app rounds it). Never a lettered square.
- **The account is Dean Stratakos** (`dean@example.com`, GitHub), photo
  `assets/dean-stratakos.jpg`, embedded as a data URL so no capture reaches
  the network. In a plan's history and bylines he is "You".
- **A mockup inside Luke** (a Page tab, a picture an agent took) is acme's own
  product, so it takes acme's palette rather than Luke's: a light, warm
  canvas (`#f3f1ec` behind white cards, `#e2e0da` hairlines, `#1b1d21` text)
  with teal `#0f766e` as its one accent. The product is called Relay
  (`acme.relay.dev`).

## Workspaces

Since 0.13.0 plans live in workspaces. Dean owns **acme**, where every plan
here lives, its GitHub organization `acme` connected, and his own
**Dean's workspace** beside it. acme is listed first, since a fixture run
lists the first workspace. acme's members are Dean (owner), Dana Moreno
(admin), Jordan Lee, Priya Raman (`priya@acme.dev`), and Theo Walsh
(`theo@acme.dev`), with sam@acme.dev invited.

Since 0.14.0 the service lists an account's own workspace first, named by
its owner ("Dean Stratakos", his photo, "Personal workspace"), then the
rest by name: acme (its mark as its photo, 5 members) and **Harbor Labs**, a
team Dean is a member of (4 members, drawn as its letter on its hue). A shot
that needs acme listed chooses it with a step. Teammates without a photo are
drawn by generated one-letter pictures on the pastels below, Theo on
`#a9d3f5`.

## Repositories

| Repository | What it is | Plans in it |
| --- | --- | --- |
| `acme/relay` | The product: workspaces, members, webhooks | Teammate invitations, Webhook retries, Audit log export, SSO with Okta (archived) |
| `acme/ledger` | Billing | Usage-based billing, Invoice PDF redesign |
| `acme/web` | The marketing site and dashboard shell | Onboarding checklist, Dark mode for the dashboard |

`acme/relay` is TypeScript on Postgres with Drizzle (`src/db/schema/`), Hono
routes (`src/routes/`), React Email templates sent through Postmark
(`src/mail/templates/`), and vitest (`pnpm test src/members`). Its skills
under `.agents/skills/` are `api-routes`, `db-migrations`, `drizzle`,
`email-templates`, `release`, and `testing`.

## The plan everything is about

**Teammate invitations** (`acme/relay`): a member invites a teammate by email
and the teammate joins by opening the link. An invite is a `memberships` row
with `state = pending`, `POST /invites` creates it and mails a one-time link,
`/invites/:token` accepts it, and a withdrawn or accepted link reads "This
invite is no longer valid". Open questions it has carried: who may withdraw
an invite (settled: the sender or any admin) and whether a link lasts 7 days
or 14. Its full document, written under every heading of the default
template, is `staging/shots/plan-document.ts`.

Other plans appear in lists and need only a name, a repository, and an age;
"Usage-based billing" (`acme/ledger`) has a short document of its own for a
shot that opens a plan other than this one.

## Coding agents and their pull requests

| Agent | Model | State | Pull request |
| --- | --- | --- | --- |
| Add teammate invitations | Claude Opus 5.5, high | Finished after 19 minutes | #214 "Add teammate invitations", open, checks passing, 9 files +412 −38 |
| Invite emails | GPT-6.1 Sol, high | Running | #216 "Send invite emails through Postmark", draft, +96 −4 |

Other plans' agents, from 0.13.0: "Meter API calls per workspace" (Usage-based
billing, Claude Sonnet 5.5; its PR is #88 "Record usage events per
workspace" on acme/ledger), "Retry failed webhook deliveries" (Webhook retries,
Claude Opus 5.5; PR #209, merged), and "Build the onboarding checklist"
(Onboarding checklist, GPT-6.1 Sol; PR #131 on acme/web).

Subagents: "Find unfiltered membership reads" (Claude Sonnet 5.5, medium),
and Luke's own "Invite link expiry". The next pull request in this world is
#217. Model ids come from the release's own model catalog, never invented.

## People

Dana Moreno (admin, `dana@acme.dev`), Jordan Lee (member,
`jordan@acme.dev`), and sam@acme.dev, the teammate being invited. Avatars
are initials on soft pastels (`#f2b880`, `#9fd8b4`, `#c7b4f5`).

## Who made what (0.15.0 on)

`team-world.ts` in `staging/releases/v0.15.0.patch` gives acme's tasks their
creators and their agents their starters: Dean created Teammate invitations and
started "Add teammate invitations"; Dana started "Invite emails" and created
Usage-based billing, Webhook retries, and Onboarding checklist; Jordan, Priya,
and Theo created the rest. Later pull requests: #217 "Expire invite links after
7 days" (acme/relay, open), #207 and #209 merged on acme/relay, #131 and #135 on
acme/web, #88, #90, and #91 on acme/ledger. Linear issues are `REL-…` (REL-142
"Invite links last 7 days", In Progress); Luke's own Issues are `ACME-…`. On
GitHub Dean is `dastratakos`, Dana `danamoreno`, Jordan `jordanlee`. The product
mockups an agent shows are Relay's Members page, invite dialog, and accept page
(`relay-pictures.ts`).

## Automations

From 0.14.0 (behind its experiment): **Morning Sentry triage**, acme's
workspace automation made by Dean, weekdays at 9:00 in the Mac's time zone,
on acme/relay and acme/web, a new agent each run on Claude Sonnet 5.5 high.
Its runs: "Fix invite accept crash on an expired token" (working, a Run now
seconds before the capture), then "Retry Postmark sends on a 429", "Guard an
empty workspace in the members query", "Fix the usage chart crash on a new
workspace", and "Stop double-sending webhook test events", finished.

## Integrations

All twelve of 0.13.0's integrations connected: GitHub 56 tools, Granola 7,
Linear 34, Mercury 9, Neon 27, Notion 14, PostHog 36, Sentry 19, Slack 12,
Supabase 29, Vercel 12, Y Combinator 8 (`shots/integrations-tools.ts` in
`staging/releases/v0.13.0.patch`). An agent's MCP popover may leave a server
switched off or not connected where that is the point.

## Time

Every time is counted back from the capture: the hero plan edited 4 minutes
ago, its agent finished 12 minutes ago, siblings from 26 minutes to 4 days,
the archived plan 18 days. A running turn started seconds before the capture,
a finished one ran minutes. Yesterday's call ran 12 minutes 41 seconds.
