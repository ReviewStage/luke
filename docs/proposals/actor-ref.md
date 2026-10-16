# Proposal: one look for whoever did it (ActorRef)

Status: **decided by Dean on 2026-10-15** and being built in the PR order in
§5. Dean: "I agree with everything in the w2209 show except I want to go with
B for shapes: circles for people and rounded squares for others. Also we
should not use transparent backgrounds for Luke/agent squares." Decisions
2–12 went as recommended (§6). Shipped: teammate photos (#2779) and the
component with its first surfaces (#2784). In review: the rest (#2796,
#2793, #2794, #2799).

The design show lives at `docs/proposals/actor-ref/index.html`. It is one
self-contained file that fetches nothing. It is built from the desktop
renderer's real stylesheet and components (`HoverCard`, `AgentTabCard`,
`AgentMark`, `WingFace`, `Message`, `Checkpoint`) over synthetic people, and
it shows every surface before and after, in light and dark (the toggle at
its head). The research behind it is `docs/proposals/actor-ref/research.md`.

Dean's ask: "Do the edited by lines have the person's profile photo? I
basically want to have the same look and feel for editors whether they are
Luke, an agent, or a person. And maybe a hover card to click to that person
or something." He added later that only agents and automations, which have
pages, are clickable: "We don't have any person page that we could click
to."

## 1. The answer, and the pick

**No.** No "Edited by" line has a photo, and no teammate's photo reaches the
window anywhere:

- The wire names a person as `memberRefSchema`'s `{userId, name}` alone
  (`packages/features/src/service-wire.ts`).
- The workspace members read carries `{userId, name, email, role}`, with no
  picture (`workspace-wire.ts`; the service's query is
  `packages/service/src/accounts/workspace-members.ts`).
- `task-crumb.tsx` passes `pictureUrl={undefined}`, and so does
  `plan-history-model.ts`'s `personOf` for anyone but the reader.

Only the reader's own sign-in picture travels (the sidebar, Settings, and
their own versions).

**Decided (B):** a circle for every person, and a solid rounded square for
Luke, a coding agent, and an automation, at one size per place.

| Actor | Its mark |
|---|---|
| A person | A circle: their sign-in photo, or the first letter of their name on one of the workspace tile's six hues, chosen from their id |
| Luke | A square: his face on his own blue (`--voice-luke`), in an ink that reads in both themes |
| A coding agent | A square: its harness mark, swapped for the working mark while it writes, as its tab does, on a solid neutral tile (`--actor-tile`) |
| An automation | A square: its clock, as its list row wears it, on the same tile |
| A former member, or someone the service can't name | A quiet outline circle |

No square is transparent. The workspace tile is a rounded square too, so an
actor's square is kept apart from it three ways: it never holds a letter,
its corner is 36% of its side against the tile's 25–28%, and the two stand
in different places (a workspace tile only where a workspace is named).

Every actor hangs a card on the shared card parts. A press opens what has a
page, an agent or an automation. A person's card is for reading only.

## 2. The component API

Pure logic goes in a package and the React parts stay in the renderer, per
AGENTS.md's layout rule.

`packages/ui/src/actor-model.ts` (DOM-free):

```ts
export const ACTOR_KIND = {
  PERSON: "person", LUKE: "luke", AGENT: "agent", AUTOMATION: "automation", SOMEONE: "someone",
} as const;

export type Actor =
  | { kind: "person"; userId: string; name: string; pictureUrl?: string;
      email?: string; role?: WorkspaceRole; you: boolean }
  | { kind: "luke" }
  | { kind: "agent"; agentId: string; name: string; provider: ModelProvider | undefined;
      state: GlyphState }
  | { kind: "automation"; automationId: string; name: string; state: GlyphState }
  | { kind: "someone"; reason: "former" | "unnamed"; name?: string };

export function actorName(actor: Actor, sentence?: boolean, possessive?: boolean): string;
// "you" / "You" / "your", "Charles Pan" / "Charles Pan’s", "Luke", the agent's title…
export function personActor(ref: MemberRef, directory: MemberDirectory, readerId?: string): Actor;
// A ref the directory doesn't hold is a former member.
export function editActor(edit: PlanLastEdit, …): Actor;   // replaces plan-body's editorOf
export function latestActivity(userId: string, plan: PlanFacts): ActivityLine | undefined;
// "Edited Rollout and Risks · 2h ago", from what the window already holds.
export function actorHue(id: string): number;              // shared with WorkspaceTile
export function actorLetter(name: string): string;         // shared with WorkspaceTile
```

`apps/desktop/src/renderer/actor-ref.tsx`:

```tsx
export const ACTOR_SIZE = { INLINE: "inline", STACK: "stack", ROW: "row", ACCOUNT: "account", CARD: "card" } as const;
//                          16px              18px            20px         26px                32px

<ActorMark actor={actor} size={ACTOR_SIZE.ROW} />           // the disc alone, aria-hidden
<ActorRef actor={actor} sentence possessive context={…} />  // disc + name, one target; hangs ActorCard,
                                                            // opens an agent's tab or an automation's page
<ActorStack actors={members} drawn={4} counted={false} />   // a facepile; "+N" only where no words count
<ActorCard actor={actor} context={…} />                     // the card for its kind (below)
```

`context` is what the place naming the actor knows and the card says:

- for a person: their latest activity in this plan;
- for Luke: whose call he wrote on, and what he wrote;
- for an agent: its `AgentSubject` and the catalog, as `AgentRef` takes them today;
- for an automation: its `AutomationSummary` and its door.

The cards, all on `HoverCard`, `CardHead`, `CardNote` and `CardRule`, with a
32px disc beside the head:

| Kind | Card | Press |
|---|---|---|
| Person | Photo, name, "You", email, role as the corner, latest activity in this plan | None |
| Luke | "During Charles Pan's call · 2h ago", then what he wrote | None |
| Agent | `AgentTabCard`: model, working or ended. "Started by" draws its starter as an actor, and its PR sits in the corner. No "Open agent": the press on its name is the way to its tab (Dean, 2026-10-16) | Opens its tab |
| Automation | Schedule, next run, whose it is, last run. No "Open automation"; hung from a control that does not open it, the Inbox's group header, its name is the way in | Opens its page |
| Someone | "Former member" or "Not named", and why the window can't say more | None |

A line that names an actor sets its words and the actor in one row centred
on the disc (`.actor-line`), so the disc never rides above the words'
baseline. The ref's hover fill bleeds by a ring of its own colour, not by
padding, so the words around it keep their spacing.

### What it replaces

| Today | Becomes |
|---|---|
| `person-avatar.tsx` `PersonAvatar` and its five CSS resizes (`.sidebar-avatar` at 26, 18, 18, 20) | `ActorMark` at a size |
| `desktop-version-history.tsx` `RevisionMark`, `plan-history-model.ts` `RevisionAuthor` and `authorName` | `ActorMark`, `Actor`, `actorName` |
| `planning/agent-ref.tsx` `AgentRef` | `ActorRef`'s agent branch (`AgentSubject` and its builders stay) |
| `plan-body.tsx` `editorOf`, `callOf`, `editedLine` | `editActor` plus `ActorRef` in `EditedLine` and `bylineOf` |
| `task-crumb.tsx`'s private `useWorkspaceMembers` | The window's member directory |
| `coding-agent-model.ts` `teammateStarter` (a name string) | A person actor |
| The `string` callers in `TranscriptCallRow.caller` and `MacOwnerContext` | Person actors |

## 3. The surfaces

| # | Surface | Today | After |
|---|---|---|---|
| 1 | The plan's "Edited by" line (`plan-body.tsx` `EditedLine`) | Text. The whole line opens the history | "Edited by [disc] Charles Pan · 2h ago". The actor hangs its card, the time opens the history |
| 1 | "Changed since you last looked" | Counts sections, names nobody | "· 2 sections by [Charles][Luke]", whose card lists who changed what |
| 2 | Section bylines (`bylineOf`) | "Edited by Luke during Charles Pan's call · 2h ago" | "[Luke] Luke during Charles Pan's call · 2h ago" |
| 3 | Version history rows (`RevisionMark`) | Bare marks for Luke and agents, a grey letter for teammates | A 20px disc per row, whose card hangs beside the row |
| 4 | Call tab divider and senders (`CallCheckpoint`, `.message-sender`) | Name strings; `transcript-model.ts` drops the id | "[disc] Charles Pan's call", and senders with discs. Luke is named on a teammate's call |
| 5 | "Started by" (`AgentTabCard`) | Text; nothing says an automation started an agent | "Started by [disc] Charles Pan" or "Started by [clock] Morning Sentry triage" |
| 6 | Inbox answers (`Proposal`, `Answered`) | "Charles Pan's pick", "Charles Pan answered" as text | Each with the answerer's disc; "Sent to [agent]" |
| 7 | "On Charles Pan's Mac" (`ToolHeader` `place`) | Text in a pill | The pill holds the owner's disc |
| 8 | Agent chat senders (worker 292) | Name only, as 292 builds it | `ActorRef` |
| 9 | Plan ⋯ footer (worker 293) | "Created by / Last edited by", name only, as 293 builds it | `ActorRef` |
| 10 | "5 can edit" and its card (`task-crumb.tsx`) | Grey letters, no "You" | Photos, and "You" in the card |
| 11 | Settings › Workspace › Members (`MemberRow`) | Name and "email · Role", no face | A 32px disc per row, and "You" |
| 12 | Sidebar account (`sidebar-foot.tsx`) | `PersonAvatar` | `ActorMark`, no visible change |
| 12 | Sidebar head | The workspace tile | Unchanged |
| 12 | Factory | **Draws no faces today**; the brief assumed it did | Unchanged (see §8) |

## 4. What has to change underneath

1. **Members carry their picture.** The members query also selects
   `user.image` through `pinnedPictureUrl`, and `workspaceMemberSchema` gains
   an optional `pictureUrl`. The optional key keeps an older desktop and a
   newer service compatible both ways. Only Google and GitHub hosts pass,
   matching the renderer's `img-src`. Members already see each other's names
   and emails in Settings, so a photo widens nothing.
2. **One member directory per window.** The crumb's `useWorkspaceMembers`
   becomes the window's one read of a workspace's members, keyed by workspace
   and read again when `memberCount` changes. Every `memberRef` resolves
   through it, so the dozen person fields on the wire need no picture of
   their own. A ref the directory doesn't hold is a former member.
3. **The Call tab keeps the caller's id.** `TranscriptCallRow.caller` (and
   the Code tab's twin) becomes the `PlanEditor` it was read from
   (`packages/voice/src/transcript-model.ts`).
4. **The account-wide Inbox's `startedBy`** is an id with no name
   (`account-inbox-wire.ts`). It resolves through the directory.
5. **An agent says which automation started it.** `CodingAgentSummary` and
   `PlanAgentLine` gain the `automationId` that `CodingAgentPage` already
   carries. The card names the automation from the automations list, behind
   `EXPERIMENT.AUTOMATIONS`; with the experiment off it says nothing more
   than today.
6. **Latest activity is derived, not read.** It comes from the plan's
   section edits, its agents' starters and its calls' callers, all already
   in the window.

## 5. The PR plan

| PR | What | Size |
|---|---|---|
| 1 | Service and wire: members carry `pictureUrl`. Store test on a real Postgres that a member's picture reads through `pinnedPictureUrl` and a foreign host is dropped | S, ~100 lines |
| 2 | `actor-model.ts`, `actor-ref.tsx`, its CSS, the cards, and the member directory. Adopted in version history (`RevisionMark` and `RevisionAuthor` go), the crumb's facepile and card, Settings › Members, and the sidebar account (`PersonAvatar` goes) | M, ~600 |
| 3 | The "Edited by" line (actor and time split), section bylines, and the changed-since facepile | M, ~300 |
| 4 | Call tab: keep the caller's id through `transcript-model.ts`; the divider and senders | S–M, ~200 |
| 5 | Agents and Inbox: "Started by" as an actor, picks and answers, the Mac place, and the account-wide Inbox's `startedBy` through the directory | M, ~300 |
| 6 | Automations: `automationId` on the agent's summary and line, `AutomationCard`, "Started by [automation]" (experiment-gated) | M, ~300 |
| 7 | Swap worker 292's agent chat senders and worker 293's ⋯ footer from name-only to `ActorRef`. Both landed (#2774, #2775) before PR 3 and 4 started, so the footer moved into PR 3 and the chat senders into PR 4, which already draw the same lines | (folded) |

PR 1 ships alone. PRs 3–6 each stand on PR 2 and on nothing else, so they
can run in parallel. PR 7 waits for 292 and 293. Each PR ships its tests
through the public export, per the testing rules: `actorName`,
`personActor` and `latestActivity` as pure functions, and the cards as
rendered output.

**Coordination.** Workers 292 (agent chat sender names) and 293 (plan ⋯
footer, "Created by / Last edited by") are building name-only versions now.
Nothing they do needs to wait. Their names should come from one helper
(`teammateStarter`, or the `memberRef` they read), so PR 7 is a swap of the
element and not a rewrite of the data.

## 6. Decisions (Dean, 2026-10-15)

Decision 1 went to B; 2–12 went as recommended.

1. **Shape: B.** Circles for people, solid rounded squares for Luke, agents
   and automations, kept distinct from the workspace tile (§1). (A, one disc
   for every actor, was the first recommendation; C was a corner badge.)
2. **A person with no photo.** The first letter of their name on one of the
   workspace tile's six hues, chosen from their id (decided). Alternatives: two
   initials, or today's grey.
3. **The person card.** Photo, name, "You", email, role, and latest
   activity in this plan, with no press (decided, per Dean).
4. **The "Edited by" line's press.** The actor hangs its card (an agent's
   also opens its tab) and the time opens the version history (decided). Today
   the whole line opens the history.
5. **Section bylines** drop "Edited by" and lead with the disc (decided).
6. **"Changed since you last looked"** gains a facepile of who changed the
   sections (decided).
7. **Luke's blue** stays on his disc only. Version history's blue name
   reads in the same ink as everyone else's (decided).
8. **Luke on the Call tab** is named over his lines only on a teammate's
   call, where the teammate is named too (decided).
9. **An automation's agent** says "Started by [automation]", which needs
   `automationId` on the agent's summary (decided).
10. **Former members** keep their name with a quiet outline and a "Former
    member" card, not a letter on a hue that looks like a current
    teammate's (decided).
11. **A facepile counts "+N"** only where no words beside it count already
    (decided).
12. **A person page:** not yet (§8).

## 7. How others draw mixed authors

The details, with a URL on every claim, are in `actor-ref/research.md`;
the show has a table.

- **People are round** everywhere.
- **Machines:**
  - GitHub's Primer: "Square Avatars represent non-human entities, such as
    bots, AI agents, teams, or organizations"
    (https://primer.style/product/components/avatar).
  - Atlassian gives AI agents a hexagon
    (https://atlassian.design/components/avatar/usage).
  - Linear and Notion put agents in the same slots as people and tell them
    apart by name and label: "clearly identified as an app user"
    (https://linear.app/changelog/2025-05-20-linear-for-agents), and
    `person` or `bot` (https://developers.notion.com/reference/user).
- **A named human stays accountable for an agent.**
  - Copilot authors a commit with the human as co-author
    (https://docs.github.com/en/copilot/responsible-use/agents).
  - Linear delegates to agents but assigns to humans
    (https://linear.app/now/our-approach-to-building-the-agent-interaction-sdk).
  - Luke does the same with "Started by" in the agent's card.
- **No photo** gets an initial on a coloured circle: Google
  (https://workspaceupdates.googleblog.com/2016/02/change-to-default-avatar-for-google.html)
  and Figma
  (https://help.figma.com/hc/en-us/articles/360041034433-Manage-name-or-avatar).
- **The hover card** shows a larger avatar and the relationship to you:
  GitHub's shared team and code owner
  (https://github.blog/news-insights/the-library/user-hovercards/), and
  Notion's email and last visit to the page
  (https://www.notion.com/help/collaborate-with-people).
- **A facepile caps at 4–5, then "+N"**: Primer
  (https://primer.style/product/components/avatar-stack) and Atlassian
  (https://atlassian.design/components/avatar-group/usage).

## 8. Should Luke have a person page?

**What others put on one:**

- Linear: the issues a member created or was assigned. An agent gets the
  same page (https://linear.app/docs/adding-and-managing-members,
  https://linear.app/docs/agents-in-linear).
- GitHub: a README, pinned repositories, the contribution graph, the
  activity feed, and organizations
  (https://docs.github.com/en/account-and-profile/concepts/personal-profile).
- Slack: name, photo, title, status, local time and pronouns. An app gets
  an App Home instead (https://docs.slack.dev/surfaces/app-home/).
- Notion: top collaborators, teamspaces, and recent activity
  (https://www.notion.com/help/people-profiles).

**What a Luke person page could hold:**

- their plans, and the ones they edited lately;
- their agents, live ones first;
- their recent edits and calls across plans;
- what they're waiting on: Inbox items on their agents, and pull requests
  to review.

**My take: not yet, as Dean leans.** In a team of two to five, every item on
that list already has a home:

- the Inbox is what's waiting;
- Factory is what's moving;
- a plan's history is who edited what;
- the person card answers the one question that comes up while reading a
  plan: who is this, and what did they do here?

A page would be a destination nobody navigates to, and a second place to
keep in step with Factory. One gap is real: "what is Charles doing right
now, across plans?" The cheap answer is a person filter on Factory (agents
and calls started by someone), not a page. I'd revisit a page at about eight
or more members, or once person @-mentions land (`at-mentions.md`, decision
6), since a mention then needs somewhere to go.
