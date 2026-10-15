# Proposal: which plans are mine (the creator's face)

Status: **proposed, awaiting Dean's pick.** Nothing is built yet.

Dean: "I can't tell which plans are 'mine' vs Charles. I think it should be
based on who created the plan."

The design show is `docs/proposals/plan-ownership/index.html`. It is one
self-contained file that fetches nothing. It is built from the desktop
renderer's real stylesheet and components (`ActorMark`, `PersonCard`,
`SidebarGroupHeader`, `PlanStatusMark`, `RepositoryDetail`, `HoverCard`,
`Segmented`, cmdk) over a synthetic Acme of five plus a former member, in
light and dark (the toggle at its head). The research behind it, with a URL
on every claim, is `docs/proposals/plan-ownership/research.md`.

## 1. Today

A team workspace's plans are shared: every member sees every plan. The
sidebar lists them in repository groups, by last update (#2818), with the
unread weight (#2801), the "!" (#2804), and the status mark and time at the
row's end. Nothing on a row says whose plan it is. The only place that
does is the ⋯ menu's footer, "Created by [face] Charles Pan · 3d ago"
(#2775).

The wire already says it. `PlanSummary.createdBy` is `{userId, name}`, and
`ownerId` is the same account. `@luke/ui/actor-model`'s `creatorActor`
draws it, and the members read carries every teammate's photo (#2779).

## 2. The designs

- **A, recommended: a teammate's plan wears its creator's face, and yours
  wears nothing.** A 14px `ActorMark` stands in a column of its own just
  before the row's time, on every row whose plan someone else created.
  Faces line up down the list whatever the time says. Under the pointer,
  Pin and Archive take the time's place and the face stays. The face hangs
  the person's card. A former member's plan wears the quiet outline.
  - *Not recommended, shown to compare:* a face on every row. Your own face
    repeats down the list and says nothing A doesn't.
- **B: a "Mine / All" segmented control** at the head of the list, kept per
  workspace. It answers "which are mine" only by hiding the rest. It doesn't
  say whose a plan is under All, it costs a row, and a teammate's plan with
  an agent at work disappears under Mine.
- **C: "Yours" and "Teammates" runs within each repository.** Teammates'
  rows still need A's face to say whose. Every repository gains up to two
  lines, and the one order by last update splits in two.

| | A | B | C |
|---|---|---|---|
| Which are mine | At a glance: no face | Only while Mine is on | By section |
| Whose is this one | The face, and its card | No | Only with A's faces |
| Added lines | None | One control | Up to two per repository |
| Order by last update | Kept | Kept | Split |
| Size | S | M | M |

**Recommendation: A.** It answers both "which are mine" and "whose is this"
where you already look. It adds no control and no line, and it doesn't
change the list's order or grouping. It costs 22px of name on a teammate's
row and nothing on yours. None of the six products researched marks only
other people's rows. Linear and GitHub name a person on every row, and
Notion and Figma make "mine" a place (Private, Drafts). So this is a
deliberate departure, chosen because a sidebar has no column to spare. Every
product that marks people on rows also offers a "created by me" view, so B
stays open as a later addition to A, not a rival to it.

## 3. Everywhere else a plan appears (with A)

| Place | Change |
|---|---|
| The plan's hover card (sidebar row, tab, Inbox crumb) | A line under the repository: the creator's face, "Created by Charles Pan · 3d ago", or "Created by you". Team workspaces only |
| The plan crumb ("Acme › relay · 5 can edit") | The crumb itself stays as it is. Its facepile leads with the creator, and its people card leads with "Created by [face] Charles Pan · 3d ago", the creator's row saying "Creator · Admin" |
| Home, Recent | The same face before the time, on teammates' plans |
| Factory (experiment) | The same face before the time |
| ⌘K | The face at a plan row's end. The creator's name is one of the words a plan is found by ("charles" finds his plans), and the detail names the creator after the repository when that is what matched |
| The Move dialog | Unchanged. Only a plan's creator may move it, so the dialog only ever opens on your own plan |
| A personal workspace | Unchanged: no face, no "Created by" in the card |

## 4. Created by, not assigned to

The face means *who created the plan*. A plan has no assignee, and editing
a teammate's plan doesn't make it yours, just as Linear's Creator and Google
Docs' Owner don't change when someone else edits.

- **A move to another workspace** keeps the creator. Only the creator can
  move a plan (`move-plan-dialog.tsx`'s `ownsPlan`, enforced by the
  service), so a moved plan arrives as theirs: unmarked for them, and
  wearing their face for the new workspace's members.
- **A creator who leaves** leaves their plans in the workspace ("Plans you
  wrote stay in Acme"). `personActor` draws them as a former member's: the
  outline, with "Created by Priya Raman, who left" in the card. A deleted
  account sends no `createdBy`, so the outline stands with no name.
- **Transfer** doesn't exist. If it is built, it changes `ownerId`, and the
  face should follow the owner, the person who can move the plan. The card
  would then say "Owned by" beside "Created by" (decision 5).
- **A plan with neither `createdBy` nor `ownerId`** (a service from before
  either was sent) wears no face, as today.

## 5. PR plan

This is desktop-only, because `createdBy` and members' photos are already on
the wire.

| # | PR | Size |
|---|---|---|
| 1 | `feat(desktop): a teammate's plan wears its creator's face in the sidebar`. Adds `teammateCreator(plan, reader)` to `@luke/ui/actor-model`, which is undefined for your own plan, an unknown owner, or a workspace of one, and adds `ACTOR_SIZE.MARK` (14px). The sidebar's rows draw it inside a `MemberDirectory` for the listed workspace, so photos and former members resolve. Tests: the model as a pure function, and a teammate's row wears the face while yours doesn't | S, ~200 |
| 2 | `feat(desktop): a plan's card and its crumb say who created it`. Adds the "Created by" line to `PlanCard`. The crumb's facepile leads with the creator, and its card leads with the line | S, ~150 |
| 3 | `feat(desktop): Home, Factory and ⌘K name a plan's creator`. The same face on Home's Recent and the Factory's rows. In ⌘K, the face, the creator's name as a search word, and the name in the detail when it matched | S, ~150 |

PR 1 ships alone. PRs 2 and 3 each stand on PR 1 and can run in parallel. If
B is wanted later, it is a fourth PR (M): a "Created by me" view option,
stored per workspace.

## 6. Decisions for Dean

1. **Which design:** A (recommended), B, or C.
2. **Teammates' plans only, or every plan:** teammates only (recommended),
   so yours is the plan with no face.
3. **Where on the row:** in its own column just before the time
   (recommended). The alternative is before the name, as the Inbox's rows
   lead with an agent's tile, but then your rows' names would start 22px
   left of everyone else's.
4. **Size:** 14px, a new `ACTOR_SIZE.MARK` (recommended), or the 16px inline
   size the Inbox's row tiles use.
5. **Owner versus creator, if transfer is ever built:** the face follows the
   owner, and the card adds "Owned by" (recommended). This doesn't matter
   today, since the two are one account.
6. **The crumb:** the facepile and the card both lead with the creator
   (recommended), or keep the members' order and only add the line.
7. **⌘K by creator:** yes, the creator's name is a search word
   (recommended). A "Mine" filter chip could come later.
8. **A "Mine" filter (B) as well:** not now (recommended). Revisit it as a
   sidebar view option if a team's list grows long enough to need hiding.
