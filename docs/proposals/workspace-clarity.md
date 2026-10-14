# Proposal: which workspace am I in, and what does it mean for my plans

Status: **Dean picked variant A** (decision 1) and the Settings labels
(decision 8) on 2026-10-14; the other decisions are still his. The one
product change so far is the attribution fix, #2638 (§1.6).

The design show is `docs/proposals/workspace-clarity/index.html`. It is one
self-contained file that fetches nothing. Each window in it is Luke's real
renderer, built from main's components and stylesheet over the renderer's own
fixture, with the variants below patched in. Pick a variant, a scene, and light
or dark at its top. "Beside today" draws main next to the variant. Notes on
the research behind §2 sit beside it, in `workspace-clarity/research-*.md`.

Dean's ask: "Charles said he's not really working on workspaces anymore. Let's
look at what's built and what we can improve on. I think it is not obvious to
the user which workspace we are working in or how that affects our plans."

Later, from Dean: **"Keep the Inbox; Chat is separate."** Everything here
builds on the Inbox. Charles's Chat (#2569–#2587) is an overlap to keep in
step with (§4.3), not a replacement.

## TL;DR

- **What's built is sound underneath.** A plan belongs to exactly one
  workspace (`plan.organization_id`), every plan read and write checks
  membership, repositories come only from the workspace's GitHub installation
  (#2524), and a plan can now move between workspaces (#2573).
- **The surface hides it.**
  - The switcher is a 12px grey line drawn like a repository's group header.
  - The plan never names its workspace or who else can edit it.
  - Only the sidebar list, Home's Recent, New plan and the repository chip
    follow the switcher. Search, the Inbox, notifications and unread marks
    cover every workspace.
  - Opening another workspace's plan switches the sidebar without a word.
  - Settings keeps a second workspace picker of its own.
- **The pick (variant A):**
  - The workspace takes Luke's place at the top left of the sidebar: a
    tile, its name, and a line saying who shares it ("5 members", or
    "Only you"). Everything under the head is that workspace's.
  - A crumb over each plan's title says where it lives and who can edit it.
  - New plan says where the plan will start.
  - Settings separates the workspace from what is yours everywhere.
  - A switch you didn't ask for says so, with a way back.
- **The plan:** eleven PRs, smallest first (§5). The first three are small
  desktop changes; rename and move need server work.

## 0. Decisions for Dean

Each decision has options and a recommendation. The show's scenes name the
decisions they draw.

1. **Where the workspace lives in the sidebar.**
   - A. It heads the sidebar in Luke's place: tile, name, "5 members".
   - B. Luke keeps the head, and the workspace is the line under his name.
   - C. A rail of every workspace's tile at the left edge, as Slack and
     Discord draw it.
   - D. Where it is today, restyled.

   **Dean picked A** ("option A is great"). It is where Slack, Linear, Vercel, Notion and GitHub put
   the scope (§2), and it reads first. The cost: Luke's face leaves the
   sidebar's head. It stays on the welcome page, the call card, and Luke's
   lines in version history. B keeps the face but is quieter. C is the
   fastest to switch, but costs 60px of sidebar, and few accounts have more
   than two workspaces.
2. **What follows the switcher.**
   - **Everything the window lists:** the plan list, Home, New plan, the
     Inbox (decision 11), Automations, and Search's first group.
   - **The list alone,** as today.

   **Recommend everything.** Search still finds every plan, with other
   workspaces' results after the listed one's, each naming its workspace.
   Chat, when it lands, is per workspace anyway (every chat table carries
   `organization_id`).
3. **Opening a plan from another workspace** (Search, the Inbox, a
   notification, a link).
   - Switch, and say so: a toast reads *Switched to Acme*, with *Back to
     Dana Reyes*.
   - Ask first.
   - Open the plan without switching, under a banner: "This plan is in Acme."

   **Recommend switch and say so.** Slack, Linear and Notion switch when
   you're a member. The silence is what's wrong today
   (`use-plans-tab.ts:786`).
4. **Switching on purpose while a plan is open.**
   - Open that workspace's last plan, or Home if it has none.
   - Keep the plan open, as today. The open plan is then missing from the
     list beside it.

   **Recommend the last plan, or Home.** The plan on screen should always
   belong to the workspace in the head.
5. **Where the choice is kept.**
   - Per window, on this Mac (`luke.chosenWorkspace` in local storage), as
     today.
   - On the account (Better Auth's `activeOrganizationId`, whose set-active
     path is disabled), so it follows you to another Mac.

   **Recommend per Mac, as today.** But there should be one choice: Settings
   › Workspace drops its own picker and shows the listed workspace
   (`app.tsx:469`).
6. **The plan's head.**
   - A crumb over the title, *Acme › relay*, ending in who can edit it:
     avatars and "5 can edit", or a lock and "Only you". Hovering lists the
     people.
   - The crumb alone.
   - Nothing.

   **Recommend the crumb and the people.** The people answer "how that
   affects our plans": everyone in the workspace can read and edit the plan,
   join its calls, and message its agents.
7. **New plan and the repository list.**
   - The dialog reads *New plan in [Acme ⌄]*, a picker in the title like
     Linear's team chip and GitHub's Owner dropdown. The repository list's
     heading names the installation: *acme-corp on GitHub · Acme*.
   - The title says the name, with no picker.
   - As today.

   **Recommend the picker and the heading.** With nothing connected, the
   list reads *Acme has no GitHub connected yet.*
8. **Settings, and #2570's heading.**
   - The page list gets three headings, as Linear and Notion group theirs:
     - the listed workspace by its name, *Acme*, over *Members and GitHub*;
     - *Account*, with the hint *Applies in all your workspaces* under it,
       over *Profile* (today's Account page, renamed so no row repeats its
       heading), *Coding agents*, *Integrations* and *Plan template*;
     - *This Mac*, over Voice, Appearance, Notifications, This Mac,
       Keyboard shortcuts and About.
   - The workspace page follows the sidebar, titled with the workspace's
     name.
   - The workspace's GitHub stays on that page.

   **Dean picked "Account" beside the workspace's name, with the hint.** His
   words on the first draft's *You, in every workspace*: "doesn't sound
   polished". #2570 merged at 20:29 (luke-agent). It put the workspace's
   GitHub under an *Integrations* heading, the same name as Account ›
   Integrations, which holds your personal GitHub link. **Recommend** that
   heading read *GitHub*, keeping #2570's Manage menu.
9. **The first workspace's name, and renaming.**
   - Name new accounts' first workspace *Personal*, and let an owner or
     admin rename any workspace.
   - Keep naming it after the person.

   **Recommend Personal, and rename.** Today the sidebar says *Dana Reyes*
   twice, once for the workspace and once for the account, meaning two
   different things. Since #2566 the first workspace can also be shared,
   which makes a person's name the wrong default. Existing ones are not
   renamed by migration. No rename route exists today.
10. **The tile's colour.**
    - Six muted hues, taken from the workspace's id.
    - A monochrome letter tile.
    - An owner picks the colour.

    **Recommend six hues from the id.** This is the only new colour. Nothing
    else is tinted, because no product researched themes its whole window
    per workspace except Slack, by the user's own choice. The tile is
    square, because GitHub draws an organization square and a person round.
11. **The Inbox.**
    - It follows the listed workspace. The switcher counts what waits in the
      others: a dot on the head, and a count beside each workspace in the
      menu.
    - It lists every workspace, each row naming its workspace.
    - As today.

    **Recommend following the workspace, with the counts.** The Inbox row's
    count then matches the list under it. The Dock badge and notifications
    stay account-wide, because they belong to the Mac, not a workspace.
12. **Outside the window.** The window title becomes *Plan — Workspace* for
    Mission Control, ⌘\` and screen shares. Once the account has more than
    one workspace, a notification's title leads with the workspace:
    *Northwind · Checkout retries*.

    **Recommend both.** No researched product documents a workspace in its
    window title, so this goes slightly beyond the norm; it costs one line.
13. **Moving a plan.**
    - *Move to workspace…* in the plan's ⋯, on #2573's route.
    - Keep only #2588's remedy under the composer.

    **Recommend the menu item, after Chat's plan channel follows a move.**
    The dialog:
    - lists your other workspaces, disabling any whose GitHub can't reach
      the repository and saying why;
    - says who loses access and who gains it, and that agents follow;
    - is offered only to the plan's starter, as the server already decides.

14. **Who is told about an agent.** Every member is badged ("Needs you",
    the Dock) and notified for every member's coding agents on a shared plan.
    - Tell only the agent's starter, and show "Started by" elsewhere.
    - Tell everyone, naming the starter.

    **Recommend the starter only.** The agent runs on the starter's keys and
    Mac, and asks them its questions. Open PR #2608 (Factory) adds more
    "you" copy, so this is worth settling first.

## 1. Audit

Read on main at `d3d1e0dc` (#2573 merged). The PR-by-PR history is the series
Charles built as "workspaces N/17": #2110, #2111, #2122, #2133, #2151, #2152,
#2124, #2135, #2153, #2250, #2268, #2274, #2396, #2414, #2418, #2427, #2500,
#2502, #2503, #2504, #2505, #2508, #2501, #2524, #2539, #2566, plus Dean's
#2517 and #2520.

### 1.1 What a workspace scopes

| Thing | Scoped to | Where you can see it today |
|---|---|---|
| Plans | Workspace: `plan.organization_id`, NOT NULL. Any member reads, edits, pins, archives and deletes | The grey switcher line over the list. Nowhere on the plan |
| Sidebar list | The chosen workspace, filtered on the Mac from every workspace's plans (`use-plans-tab.ts:575`) | The switcher line |
| Home › Recent | The chosen workspace | Not labelled |
| New plan | The chosen workspace (`use-plans-tab.ts:1179`); the server falls back to the first workspace | Not said in the dialog |
| Repositories | The workspace's one GitHub installation (#2524) | Only when none is connected (`repository-chip.tsx:76`) |
| Coding agents | Their plan's workspace. They run as their starter, whoever messages them | Not said |
| Pins, archive | Stamps on the plan, so workspace-wide | Not said: one member's pin moves everyone's sidebar |
| Inbox | Every workspace's plans | Not labelled |
| Search | Every workspace's plans | Rows name the repository (`command-palette.tsx:360`) |
| Notifications | Every workspace | Title is the plan's name (`agent-notices.ts:289`, `:303`) |
| Voice call | Its plan's workspace | The call card names the plan |
| Integrations (MCP) | Your account | Settings › Integrations, not marked as yours |
| Personal GitHub link | Your account, for GitHub's MCP tools only (#2539) | Settings › Integrations › GitHub |
| Model keys, spend | Your account | Settings › Coding agents, Account |
| Plan template | Your account: a team plan starts from its starter's template | Settings › Plan template |
| Repository pins | Your account | — |
| Automations (open PRs) | Their owner, while the owner reaches the plan | The page lists the account's, unfiltered |
| Chat (open PRs) | Workspace: every table has `organization_id`, one `#general` each | Not yet drawn |
| Memory, skills | No memory. Skills come from the plan's repository | — |
| Current workspace | Per window, this Mac's local storage (`chosen-workspace.ts:21`) | The switcher. Settings › Workspace has its own picker (`app.tsx:469`) |
| Links | `luke://plan/<id>`, no workspace, in-app only, provisional | Opening one switches the sidebar without saying so |
| Window title | — | Always "Luke" (`panel-manager.ts:310`) |

Roles matter only to members, invitations and GitHub. Owner, admin and member
differ in connecting or disconnecting GitHub, inviting, and removing members.
Nobody can rename or delete a workspace, change a role, or transfer
ownership, and an owner can't leave.

### 1.2 What happens on a switch

- **What changes:** the sidebar's list, Home's Recent, the workspace New plan
  starts in, and the repository chip's list. The choice is written to
  local storage, so the next launch opens on it.
- **What stays:** the open plan, even when it is another workspace's. Also the
  Inbox and its count, Search, notifications, the call and its card,
  Automations, and Settings › Workspace if a link chose its workspace.
- **Opening another workspace's plan** from Search, the Inbox, the history or
  a `luke://` mention switches the sidebar once the plan opens, and says
  nothing.
- **Deep links** carry only the plan's id. Worker 273 is settling canonical
  links (§4.4).
- **Notifications** from another workspace look like any other.
- **The voice call** knows its workspace only through its plan.

### 1.3 The top confusions

1. **The switcher doesn't read as the workspace.** *Acme ⌄* is grey, 12px,
   under the rule, and drawn like *relay*, the repository header beneath it.
   It looks like a group in the list, not the window's scope.
2. **A plan never says where it lives, or who else is in it.** A plan in Acme
   can be edited by Acme's other members, who can join its calls and
   message its agents, and nothing on the plan says so.
3. **Half the window follows the switcher, half doesn't.** The list does;
   the Inbox count above it doesn't.
4. **Switches happen silently.** Opening a plan from Search can leave the
   window on a different workspace, this launch and the next.
5. **The first workspace has the person's name.** The head and the account
   row both say *Dana Reyes*.
6. **Settings mixes "this workspace" and "you".** Workspace sits between
   Account and Coding agents, with a picker of its own. Integrations, keys
   and the template apply in every workspace, but nothing says so.
7. **New plan and the repository list don't name the workspace** they work
   in.

### 1.4 Gaps and half-finished pieces

- **No rename, delete, role change or ownership transfer** for a workspace,
  and an owner can never leave one.
- **No desktop door to #2573's move** except #2588's remedy, which is open.
- **A moved plan's Chat channel stays behind** in the old workspace: the
  agent and planner members are globally unique, so they can't be remade in
  the new one (Chat's open PRs).
- **Pins and archive are workspace-wide,** and any member can permanently
  delete a teammate's plan, with no trash. That may be intended, but it is
  undocumented in the UI.
- **Deleting an account deletes the plans it started in shared workspaces**
  (`plan.user_id` cascades), along with their agents and Inbox items.
- **Stale comments still describe plans as owner-only**
  (`plan-skills.ts:9`, `plans-app.ts:157`, `repository-pin.ts:8`).
- **Owed:** Mac `verify.sh` on most of the series' UI PRs, invitation email,
  storing the GitHub login, and a live Remove, Leave and Invite on a Mac.
- **No server-side per-workspace plan list or search.** The Mac filters the
  whole list.
- **The audit's access findings** are reported to Dean separately rather than
  here, since this repository is public.

### 1.5 Open PRs and in-flight work

- **#2570** (luke-agent): the workspace's GitHub under an *Integrations*
  heading with one Manage menu. Merged 2026-10-14 20:29, after this audit
  first read it as open. Decision 8 recommends renaming its heading.
- **#2573** (merged) and **#2588** (open, Dean): a repository out of reach
  says why. #2573 moves a plan stranded by #2524 to the workspace that
  reaches its repository. #2588's remedy calls a new `planning.move` act,
  which PR 11 reuses.
- **Chat** (#2569–#2587, Charles): separate from the Inbox, per Dean. Every
  table is per workspace, DMs never cross workspaces, and its desktop reads
  one workspace's channels. That fits decision 2. It doesn't yet follow a
  plan's move (§1.4).
- **Automations** (#2516–#2564, Dean; worker 259):
  - Today an automation is owned by an account, anchored to a plan, and
    unfiltered by workspace on the page.
  - Worker 259 adds an owner scope, personal or workspace. Its wording
    should avoid "personal" (§4.2).
- **Worker 276's** "Luke can't reach this plan's repository" is what #2573
  and #2588 fix.

### 1.6 Who did what

Dean, in Stage, which he shares with Charles: "it says everything is 'You'
when really me and Charles are both doing work there." The renderer was
written when a plan had one person. #2133, #2151 and #2152 shared plans,
agents and calls with the whole workspace, and the copy kept saying "you".

**Fixed in #2638** (the plan's "Edited by" line, each section's byline, the
version history). A plan revision stored only its writer's kind, never the
member, and the window drew every developer revision as the reader's own.
Revisions now keep the member (`plan_revision.user_id`), and the wire carries
`by: { userId, name }`. The window says "you" only where that id is the
signed-in account's (`AccountSnapshot.id`), and names a teammate otherwise.
It says "someone" where no member can be named: an account that is gone, or
an edit from before writers were kept. Two members' saves are no longer
joined into one revision, Luke's notes say whose call they were taken on,
and a teammate's edit types in rather than landing as if the reader typed
it.

**Still wrong for a teammate's work**, from an audit of every attribution
(most visible first). Two server facts shape the fixes:
- rows are written under a conversation's opener, not its speaker, so
  `messages.user_id` can't say who spoke or typed;
- `voice_sessions.user_id` is the caller, so whose call a turn was is one
  join away.

Every fix reuses #2638's `by` and the account id.

| Surface | Today, for a teammate's work | Fix | Size |
|---|---|---|---|
| Call tab: each call's divider and its bubbles | A teammate's call draws as the reader's own bubbles, with no name | `by` on each call, from `voice_sessions.user_id`. The divider reads "Charles's call", and his bubbles carry his name | S |
| Who started an agent | Nothing says whose agent it is. The task draws as the reader's bubble | `startedBy` on the agent summary, from `coding_agent.user_id`: "Started by Charles" | S |
| An agent tab's messages | A teammate steering an agent draws as the reader's own bubble; the sender is dropped at `steer.ts` | The sender in the typed message's metadata, then `by` on the message | M |
| Inbox answers | "You chose…", "Your pick", whoever answered | `answeredBy`: a column on `inbox_item`, since the Inbox stays | M |
| "Changed since you last looked" | Skips every developer edit, so a teammate's never lights up | Skip only the reader's own (`by.userId`) | S |
| "Your API key was refused", "On your Mac" | Names the reader for the starter's key or Mac | "Charles's API key…", "On Charles's Mac", once `startedBy` lands | S |
| "Needs you", the Dock badge, agent notifications | Every member is badged and notified for every member's agents | Decision 14 | M |
| Automations list (open PRs) | Teammates' automations will list as yours | `createdBy`: "By Charles" | S |
| "Read your inbox", "Your plans could not be read" | Mild | "the inbox", "the plans" | S |

Correct today, and unchanged:
- the caption strip's "You", which only ever shows your own call;
- "End your call on…";
- plan rows and pull-request cards, which name no author.

One more, outside the window: the call history Luke's voice is given
includes every member's earlier calls, so he may tell Dean "you said" about
Charles's words. The caller field from the Call tab row lets the prompt name
the speaker.

## 2. How others do it

Read on 2026-10-14 from each vendor's docs. Full notes with every citation:
`workspace-clarity/research-slack-linear-notion-vercel-github.md` and
`workspace-clarity/research-figma-discord-raycast-cursor-chatgpt.md`.
Anything marked "from product familiarity" there is unsourced.

- **The switcher is the scope's name at the top left.**
  - Slack: "Click the workspace icon in the top left"
    ([Slack](https://slack.com/help/articles/1500002200741-Switch-between-workspaces)).
  - Linear: "Click the workspace name in the top-left corner"
    ([Linear](https://linear.app/docs/workspaces)).
  - Vercel: "the team switcher at the top left of the navigation bar"
    ([Vercel](https://vercel.com/docs/accounts)).
  - Notion: the classic sidebar puts it at the top, the new one at the
    bottom ([Notion](https://www.notion.com/help/sidebar)).
  - Discord gives every server a slot in a rail
    ([Discord](https://support.discord.com/hc/en-us/articles/360034842871-How-do-I-join-a-Server)).
  - ChatGPT puts it under the profile icon
    ([OpenAI](https://help.openai.com/en/articles/8265430)).
- **Identity is an avatar, rarely a colour.**
  - Every product draws a workspace icon.
  - Slack alone suggests colour, through the user's own theme: "try selecting
    a different theme for each one to help tell them apart"
    ([Slack](https://slack.com/help/articles/205166337-Change-your-Slack-theme)).
  - Linear colours teams, not workspaces
    ([Linear](https://linear.app/changelog/2022-01-20-linear-preview-new-sidebar-and-team-icons)).
  - GitHub's Primer: "Square Avatars represent … organizations", and circles
    represent people ([Primer](https://primer.style/product/components/avatar/)).
- **The scope leads the breadcrumb.**
  - GitHub (`owner / repo`) and Vercel (`team / project`) start the path with
    the scope.
  - Notion's breadcrumbs "show you what page you're in, and where that page
    lives" ([Notion](https://www.notion.com/help/create-a-subpage)).
- **Creating something names where it goes.**
  - GitHub's **Owner** dropdown
    ([GitHub](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository)).
  - Linear: "Issues must belong to a single team"
    ([Linear](https://linear.app/docs/creating-issues)).
  - Notion's location dropdown
    ([Notion](https://www.notion.com/help/navigate-with-the-sidebar)).
  - Raycast's **Organization** field
    ([Raycast](https://manual.raycast.com/snippets.md)).
  - Vercel only asks you to "ensure you have selected the correct team"
    ([Vercel](https://vercel.com/docs/projects/managing-projects)), the
    weakest of these.
- **Settings are split by heading in one place.**
  - Linear has **Account / Features / Administration / Your teams**
    ([Linear](https://linear.app/changelog/2024-12-18-personalized-sidebar)).
  - Notion has *{your name}* / Preferences / Workspace
    ([Notion](https://www.notion.com/help/workspace-settings)).
  - ChatGPT has Settings beside **Workspace settings**
    ([OpenAI](https://help.openai.com/en/articles/8411955)).
- **Other workspaces' activity shows as a badge, or one inbox with a filter.**
  - Slack: "a numbered badge on your workspace icon when there's unread
    activity in your other workspaces"
    ([Slack](https://slack.com/help/articles/360025446073-Guide-to-Slack-notifications)).
  - Discord badges each server and folder.
  - GitHub keeps one inbox with an `org:` filter
    ([GitHub](https://docs.github.com/en/subscriptions-and-notifications/reference/inbox-filters)).
  - Linear and Notion scope the inbox to one workspace.
- **Cross-workspace links are mostly undocumented.**
  - Switching when you're a member is common practice, but no doc says so.
  - Non-members fail closed. ChatGPT redirects home "with a message that they
    do not have access"
    ([OpenAI](https://help.openai.com/en/articles/8798634-data-access-for-your-managed-chatgpt-account)).
  - Figma and Notion offer a request for access.
- **Moving between scopes is a reviewed act that lists what's lost.**
  - GitHub: type the name, then *I understand, transfer this repository*
    ([GitHub](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository)).
  - Vercel shows a review screen
    ([Vercel](https://vercel.com/docs/projects/transferring-projects)).
  - Slack confirms twice and lists what moves
    ([Slack](https://slack.com/help/articles/115001946688-Move-channels-between-workspaces-in-an-Enterprise-organization)).
  - Figma: moving "may change who can access the file"
    ([Figma](https://help.figma.com/hc/en-us/articles/360038511573)).
  - Notion copies rather than moves across workspaces, with *I understand,
    duplicate* ([Notion](https://www.notion.com/help/transfer-content-to-another-account)).
  - ChatGPT allows only a one-way bulk merge
    ([OpenAI](https://help.openai.com/en/articles/8801890)).
- **Personal spaces are folding into the team model.**
  - Vercel turned personal accounts into Hobby teams
    ([Vercel](https://vercel.com/changelog/2024-01-account-changes)).
  - Figma moved Drafts into each team because standalone drafts "made
    ownership unclear"
    ([Figma](https://help.figma.com/hc/en-us/articles/18409526530967-Updates-to-how-drafts-work)).
  - Linear has no personal workspace at all.
  - This matches #2566's "a personal workspace is just the first workspace".
- **Window titles:** no vendor documents one.

## 3. The design

All three variants share §3.2 to §3.8. Only the sidebar's head differs. In
the show, flip between them per scene, or draw any of them beside today.

### 3.1 The sidebar's head (decision 1)

- **A (pick):** the head row is the switcher:
  - the workspace's tile (32px, square), its name at 14/650, and under it
    *5 members* or a lock and *Only you*;
  - a dot in the attention colour (`--state-attention`) while something
    waits in another workspace;
  - a chevron.

  The old line over the list goes. A press drops the existing `ActionMenu`:
  every workspace with its tile, the listed one checked, the others
  counting what waits, then *New workspace* and *Workspace settings*.
- **B:** Luke's face and name stay, and the line under *Luke* is the
  switcher: a 16px tile, the name, and a chevron.
- **C:** a 56px rail of tiles along the sidebar's edge, each counting what
  waits, with + for a new workspace. The head names the listed workspace
  with its gear.

### 3.2 The plan's crumb (decision 6)

Over the title, in the edited line's 12.5px voice:

- the workspace's tile and name, which opens its settings;
- `›` and the repository's name;
- at the line's end, up to four avatars and *5 can edit*, or a lock and
  *Only you*.

The hover card uses the window's own card parts. It names *Everyone in Acme*,
says that each member "can read and edit this plan, join its calls, and
message its agents", and lists them with their roles.

### 3.3 New plan and the repository list (decision 7)

- **New plan:** the title reads *New plan in* followed by a pill chip, the
  workspace's tile and name, which drops the workspaces. Changing it
  re-reads the repository chip's list.
- **The repository list:** its section heading reads *acme-corp on GitHub ·
  Acme*, using `SearchableMenu`'s own `section`. The not-connected note names
  the workspace.

### 3.4 Settings (decision 8)

- **The page list:** three headings, in the list's own `.section-heading`:
  the workspace's tile and name, *Account* with its hint in the tertiary
  ink, and *This Mac*.
- **The workspace page:** titled with the workspace's name. Its picker gives
  way to a row with the tile, the role and member count, and *Rename*
  (decision 9). Its GitHub group reads *GitHub*.
- **Account's own page** reads *Profile*, in the list and at its head.

### 3.5 Switching (decisions 3, 4)

- **A switch you didn't ask for** toasts *Switched to Acme* with *Back to
  Dana Reyes*. This uses the existing toast and its one action.
- **A switch you asked for** shows nothing more than the head changing. The
  column opens the workspace's last plan, or Home.

### 3.6 From another workspace (decisions 11, 12)

- **Notifications** lead with the workspace.
- **Search** results from another workspace name it in their detail.
- **The switcher** counts what waits elsewhere.

### 3.7 Moving a plan (decision 13)

*Move to workspace…* sits beside Change repository in the plan's ⋯. The show
stages #2573's own case: a plan on `acme-corp/relay`, stranded in Dana's own
workspace. Acme is offered. Northwind is disabled, with *No GitHub connected
· can't reach acme-corp/relay*. Beneath the list, three lines:

- who loses access;
- who gains it;
- that the agents keep running on the target's installation.

The act reads *Move to Acme*.

### 3.8 The first workspace (decision 9)

- **Look:** the same square tile as any workspace, with *Only you* and a lock
  in the head and the crumb.
- **Name:** *Personal* for new accounts, and renamable.

## 4. Overlaps

### 4.1 Chat (Charles)

Chat is separate from the Inbox, per Dean. It is built per workspace, so
decision 2's "everything follows the switcher" is the scope its sidebar entry
needs anyway. Two asks for Charles:

- make a plan's channel and its agent and planner members follow #2573's
  move;
- take the listed workspace from the same `useChosenWorkspace` the plan list
  uses, rather than a second choice.

### 4.2 Automations (Dean; worker 259)

- **The page:** follows the listed workspace, filtered by the plan's
  workspace. That is a small change to #2525.
- **Worker 259's owner scope:** should read *Only me* or *Everyone in
  Acme*, never "personal". Since #2566, "personal" names a workspace, so a
  "personal automation" in a team workspace would read as a contradiction.
- **Where questions land:** an automation's questions stay in the Inbox,
  which now stays.

### 4.3 The Inbox and `use-plans-tab.ts`

Three open chains rewrite the same window-page slot in
`use-plans-tab.ts`:

- #2525 (Automations beside the Inbox);
- #2579 (Chat beside the Inbox);
- #2580 (removing the Inbox). Dean's decision keeps the Inbox, so this one
  should not merge as is.

PR 8 here touches the Inbox's scope in the same file, so it goes after #2525.

### 4.4 Links (worker 273)

- **What a canonical link carries:** the plan's id alone. Opening it resolves
  the plan's workspace and switches as decision 3 says.
- **A non-member:** gets the same "no access" answer as an unknown id, and
  never the workspace's name, which a non-member must not learn.

## 5. Plan: the PRs, smallest first

Sizes: **S** about 150 lines or less, **M** about 400, both counting tests.
Each desktop PR is visual, so it needs a `verify.sh` pass on a Mac, and its
body must say CI could not verify it.

| # | PR | Size | Touches | Overlaps |
|---|---|---|---|---|
| 1 | Window title *Plan — Workspace*; notification titles lead with the workspace when there's more than one (decision 12) | S | desktop renderer and `agent-notices.ts` | — |
| 2 | The workspace tile and its six hue tokens, light and dark; the switcher menu's rows wear it (decision 10) | S | desktop | — |
| 3 | New plan in [workspace]; the repository list's heading names the installation; the not-connected note names the workspace (decision 7) | S | `new-plan-dialog.tsx`, `repository-chip.tsx` | #2588 touches the chip's remedies |
| 4 | `GET /api/workspaces` answers each workspace's member count | S | web, `workspace-wire.ts` | — |
| 5 | The sidebar's head becomes the switcher (variant A), and the old line goes (decision 1) | M | `desktop-sidebar.tsx`, `workspace-switcher.tsx` | Chat's sidebar entry (#2579) |
| 6 | The plan's crumb and its people card (decision 6) | M | `plan-body.tsx`, members read cached per workspace | — |
| 7 | Switching says so: toast with Back; a switch on purpose opens the workspace's last plan or Home; Search names other workspaces (decisions 3, 4) | M | `use-plans-tab.ts`, `chosen-workspace.ts`, `command-palette.tsx` | Links (worker 273) |
| 8 | The Inbox follows the listed workspace; the switcher counts the others (decisions 2, 11) | M | `use-plans-tab.ts`, the Inbox, the switcher | #2525, #2579, #2580 in the same file |
| 9 | Settings' three headings; the Workspace page follows the sidebar; close #2570 (decision 8) | M | `desktop-settings.tsx`, `workspace-page.tsx`, `app.tsx` | #2570 |
| 10 | Rename a workspace (owner or admin); new accounts' first workspace is *Personal* (decision 9) | M | web route over Better Auth's update, `workspace-store.ts`, desktop | — |
| 11 | *Move to workspace…* on #2573's route, reusing #2588's act (decision 13) | M | desktop, the plan's ⋯ | Chat's plan channel (§4.1) |

PRs 1–3 have no dependencies. PR 5 needs 2 and 4. PR 8 waits for #2525.
PR 11 waits for #2588 and for Chat's move handling, if Chat merges first. The
access findings in §1.4 are fixed in their own PRs, apart from this plan.

## 6. Not doing

- **A workspace-coloured window or accent.** Only the tile carries colour.
- **Workspace deletion, role changes and ownership transfer.** These are
  real gaps (§1.4), but not about clarity. Each is its own proposal.
- **Workspace-shared model keys, billing or templates.** These stay with the
  account, and the *Account* heading's hint, *Applies in all your
  workspaces*, now says so.
- **Moving many plans at once,** or a bulk merge like ChatGPT's.
