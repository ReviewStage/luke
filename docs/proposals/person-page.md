# Proposal: a page for a person, so a press on a teammate goes somewhere

Status: **B decided by Dean on 2026-10-15, with every recommendation in §7
and the PR split in §5, and being built in that order.** One change: "Can we
keep profile photos for people who have left and just gray them out?" A
member who left keeps their own sign-in picture wherever they are drawn
(chips, cards, facepiles, rows, and their page's head), in grayscale and
muted, rather than the outline that stands for them today; their name keeps
"Former member" and "who left", so colour is never the only sign. The
shared `ActorMark` draws it, so every surface has it at once. The service
keeps no row for a membership that ended, so the members read also names
the people the workspace's work still credits who are no longer in it, with
their picture (§5, PR 6).

Dean: "Let's design out a page that represents a person. So that clicking on
person chips does something."

The design show is `docs/proposals/person-page/index.html`. It is one
self-contained file that fetches nothing. It is drawn by the renderer's real
components and stylesheet: `ActorRef`, `ActorMark`, `ActorStack`,
`PersonCard`, the someone and GitHub cards, `CardDoor`, `PlanCrumb` and its
`PeopleCard`, `WorkspaceRef`, `SidebarSectionHead`, `SidebarGroupHeader`,
`CreatedByChip`, `MenuRow`, `PullRequestMark` and `StateGlyph`. About forty
lines of new CSS sit on top, for the page's head, the People rows and the ⌘K
mock.

The show uses a synthetic Acme: five members (Dean, Maya Okafor, Charles Pan,
Lena Fischer and Sam Ortiz) plus Priya Raman, who left. It also has @jkoh, a
GitHub contributor who isn't a member, and dependabot. Every frame is drawn
in light and dark. The research behind it, with a URL on every claim, is
`docs/proposals/person-page/research.md`.

## 1. Today

A person is drawn as a circle and their name (`ActorRef`), hanging
`PersonCard`: their face, name, email, and role, plus their latest edit when
the person is shown in a plan. No caller passes `onOpen` for a person, so a
press does nothing. `actor-ref.tsx` says why: "the window has no page for a
person." An agent and an automation, by contrast, open their pages.

The crumb's "5 can edit" was made to press nowhere by #2894 ("let's just not
have it navigate anywhere").

The show's §2 lists every surface that draws a person: bylines, the plan ⋯
footer, the crumb's people card, version history, agent transcripts and the
origin line, "Started by", the Call tab, Inbox picks and answers, Changes
(Opened by, reviewers, commit authors), the faces on sidebar, Home and
Factory rows, the task card, ⌘K, Settings › Members, the account, and
automation owners.

What the window knows about a member is `{userId, name, email, role,
pictureUrl?}`. It holds no GitHub login, no join date and no last-active
time.

## 2. Recommended: B, a person's page in the workspace you are in

Pressing any named person opens their page, the way pressing an agent or an
automation opens theirs. Their hover card is read, never a door: Dean later
decided that no hover card carries an "Open" button, since pressing the name
it hangs from already opens what it names.

The page stands in the plan's place, as Factory, Automations and an agent's
page do (`STAND_IN.PERSON {userId}`), and Back returns from it. Its head is:

- their face at 48px;
- their name;
- a line of their role and email. Dean decided the page shows no GitHub
  login, since the service keeps only GitHub's numeric account id.

Under the head is one column in Home's own voice. Each section lists only
what the window already reads for the listed workspace:

| Section | Source | Never |
|---|---|---|
| Working now | Agent lines whose `startedBy` is them and that are at work | Their one-off agents (#2932 lists only your own) |
| Waiting on their answer | Open Inbox items from their agents, which every member's Inbox already lists | Answered items, or what anyone answered |
| Created | Tasks with their `createdBy`: five, then Show all in sidebar | |
| Agents | Their stopped agents, each with its pull request | |
| Automations | Workspace automations they own | Their personal automations |

A section with nothing in it is left out. The toolbar has one button, **Their
tasks in sidebar**, which calls #2899's `onCreatedBy`. ⋯ holds:

- Copy link to profile, after 341 adds the link;
- Copy email;
- Manage in workspace settings, for owners and admins.

### The cases

| Who is pressed | What opens |
|---|---|
| A teammate | Their page in the listed workspace |
| You | Your page, with You and "Waiting on you". It has no Edit profile: Dean later decided there is nothing on it to edit |
| A former member | Their page, read-only: Former member, whatever of theirs is still in the workspace, no email, and ⋯ holding only Copy link |
| A GitHub user who isn't a member | Their GitHub profile in the browser (↗), by the login GitHub names them by |
| A GitHub login linked to a member | That member's page (`githubActor` already resolves the `userId`) |
| Your personal workspace | Your page lists that workspace alone, with no sidebar filter |

A page never reaches across workspaces. It never shows another workspace the
two of you share, or anyone's personal workspace.

Facepiles stay put, as #2894 decided. The faces inside sidebar, Home and
Factory rows stay part of their rows. A card's people rows press. The task
card's "Created by" line becomes an `ActorRef`. ⌘K gains a People group, and
the Settings › Members ⋯ gains Open profile.

## 3. The other directions

- **A. No page: a richer card that a press pins.** The card adds counts of
  the person's tasks, working agents and Inbox items, then two doors: Show
  their tasks and Copy email. It's one PR. Against it:
  - it adds a second kind of popover;
  - the keyboard never enters a card;
  - the press only holds the same card still.
- **C. No page: a press filters.** Pressing a person filters the sidebar,
  Home, Factory and Inbox to them, using #2899's chip. That's the Vercel,
  Devin, Height and Jira-board model. Against it:
  - a name in a sentence rewrites your sidebar;
  - it says nothing about who the person is;
  - Factory and the Inbox each need a filter they don't have.

  B keeps the same filter as the page's button.
- **D. People, a place for the team.** A sidebar row lists every member with
  what they're working on, plus former members and GitHub people. Each
  person's page adds an Activity feed. That's the Conductor 0.91 and Notion
  model. Against it:
  - it needs a new workspace-wide activity read, cut to what the viewer may
    open;
  - it needs a new sidebar row;
  - it's the per-person aggregation that other tools keep to admins;
  - it overlaps Factory.

## 4. Privacy

Every direction shows only what the viewer could already see in that
workspace. A, B and C add no new read: B regroups items the sidebar's Created
by filter, agent cards, the Inbox and Automations already show to any member.
Email shows where it already shows, on the card and in Members.

No direction ever shows:

- another member's personal workspace or personal automations;
- their one-off agents;
- their Inbox answers, or what anyone answered;
- call words, or whether they are on a call;
- last active or online state;
- the other workspaces they belong to;
- any credential.

D's activity feed is the one new read, and it would need the same cuts plus a
check that each event's item is one the viewer may open.

## 5. PR split for B

1. `feat(ui,desktop): a person's page in the workspace`. This PR adds:
   - the DOM-free `packages/ui` `person-page-model.ts`;
   - `STAND_IN.PERSON` and `PLACE_KIND.PERSON`, with Back, `sameStep` by
     userId, and `reachable`;
   - the page itself on Home's parts;
   - its tests.
2. `feat(desktop): a press on a person opens their page`. The person branch
   of `ActorRef` goes through one `useActorDoor`. The PR also covers:
   - a former member's page;
   - Open on GitHub for a GitHub user who isn't a member;
   - the crumb card's rows;
   - the task card's Created by line.
3. `feat(desktop): ways to a person: ⌘K, Members, and the sidebar filter`.
4. `feat(desktop,features): copy a link to a person`, after 341.
5. `feat(service,features,desktop): a person's page lists the workspace's
   automations they made`. The GitHub login this PR was to add is dropped
   (decision 11).
6. `feat(service,features,ui,desktop): a member who left keeps their picture,
   grayed`: the members read names who left with their picture, and
   `ActorMark` draws it in grayscale.

## 6. Overlap with active work

| Work | What the overlap is | How it's handled |
|---|---|---|
| 341, copy link | A person link kind | PR 4 waits on 341's link model |
| 339, chain F (#2938) | "· started by <teammate>" | Keep the teammate an `ActorRef` so it inherits the press |
| 324, sidebar (#2899, #2904, #2905) | Created by filter | The page's button reuses the filter. ⌘K's People group sits beside the view commands |
| 340, Factory | Creator faces, "what is at work" | Faces stay part of their rows. D overlaps Factory most |

## 7. Decisions, recommendation first

1. **Direction.** B (or A, C, D).
2. **What presses.** Named people and a card's people rows. Piles and row
   faces don't, and no hover card carries an Open button (Dean, later).
3. **Pressing yourself.** Your own page. Dean later dropped its Edit profile,
   since there is nothing on it to edit.
4. **Scope.** The listed workspace only.
5. **A former member.** A read-only page (or no press).
6. **A GitHub user who isn't a member.** The press opens GitHub.
7. **v1 sections.** Working now, Waiting on their answer, Created, Agents,
   Automations. No Activity, presence or last active.
8. **Door words.** Open profile, in menus only: Settings › Members' ⋯.
9. **Actions.** Their tasks in sidebar, plus ⋯ for the rest. No Message and
   no Mention.
10. **Placement.** A stand-in page with Back, no sidebar row, and a ⌘K People
    group.
11. **Members carry a GitHub login and leave date.** Dropped: Dean decided
    the page shows no GitHub login, with no follow-up.
