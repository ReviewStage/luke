# Proposal: Settings › Workspace, finished

Status: **awaiting Dean's pick.** Nothing below is built yet.

Dean's ask: "I really don't like the workspace settings page. It needs a
redesign to look more finished." Then: "It should match our other settings
pages and also the rest of our app (e.g. even small things like the You chip
don't match what we have in the rest of the app)." So the bar is
consistency, not novelty.

The design show is `docs/proposals/workspace-settings/index.html`, one
self-contained file that fetches nothing. Every frame in it is the real
`DesktopSettings` from `main` (e8c0576c) on the renderer's real stylesheet,
over synthetic people, in light and dark (the toggle at its head). Today's
frames run main's Workspace page unchanged; the two directions swap only that
page, built from the Settings kit's own parts and about 60 lines of CSS. The
research behind it, with its sources, is
`docs/proposals/workspace-settings/research.md`.

## 1. What is unfinished today

1. **The You badge is jammed against the name.** The page wraps
   `YouBadge` in `.member-name`, which has no rule. The person card and the
   plan crumb put the same badge 6px off the name (`.actor-card-name`).
2. **Two dead rows open the page.** "Your role · Owner" has nothing to do,
   and "Name · Acme" repeats the page's title one line below it. A personal
   workspace also gets a Name row with no Rename.
3. **Three sizes of leading mark:** the photo tile at 48px
   (`TILE_SIZE.SETTINGS`, used nowhere else), member faces at 32px, and
   GitHub's mark at 20px. Invitations have no mark at all, so their words
   start 44px left of the members' words in the same card.
4. **The member list has no column.** The role is tacked onto the email,
   and rows with a ⋯ and rows without end at different places.
5. **The Members card holds four kinds of thing:** the invite form, the
   pending invitations, the members, and Leave, with no heading between them.
6. **Leave sits mid-page**, under the members and above GitHub.
7. **GitHub is said twice** (the group and the row), and the row never
   names the account it is connected to.
8. **Bug:** an admin's own row offers Remove from workspace
   (`removable = manages && role !== OWNER` does not exclude the reader).
9. **Failure lines break `read-failure.tsx`'s convention.** A failed read
   says the service's refusal rather than "The members could not be read."
10. **Invitations don't say when they expire**, although the wire carries
    `expiresAt`.
11. **Renaming swaps the row's words for a bare field**, losing the label.
12. **The sidebar calls the page "Members and GitHub"**, though it opens on
    the role, the name, and the photo.

## 2. Each element and the shared part it uses

| Element | The app-wide part | Today | A and B |
|---|---|---|---|
| Your own row's "You" | `YouBadge` in `.actor-card-name`, as the person card draws it (#2784) | No gap | The card's wrapper |
| A member's face | `ActorMark`, `ACTOR_SIZE.CARD` (32px) | Yes | Yes |
| Someone invited | `ActorMark`'s outline "someone", same size | No mark | Outline face; the words line up |
| The workspace | `WorkspaceTile` at `TILE_SIZE.HEAD` (32px), where Profile has its 30px picture | 48px | 32px; `TILE_SIZE.SETTINGS` deleted |
| Rows and groups | `SettingsGroup`, `.settings-row`, `MenuRow` | Yes | One kind of thing per group |
| A row's acts | One bordered button at its end, the rest in its ⋯ (`ActionMenu`) | Spread over three rows | One identity row: Rename, photo in ⋯ |
| Role words | `ROLE_WORDS`, a value column as Keyboard shortcuts sets a chord (A), or a field `Chip` like every Settings picker (B) | On the email line | Its own column |
| GitHub | Integrations' row: 20px mark, `.settings-state`, Connect, the `Chip` Manage door | Unnamed account | "Connected to acme-dev" |
| Leave | Profile's Delete account row | Mid-page | Its own group, last |
| Asking first | `ConfirmDialog` | Yes | Yes; B's invite is the same dialog with a field, as New workspace asks |
| A failed read | `ReadFailure`: "The X could not be read." and Retry | Service's sentence | The convention's |
| A list with nothing in it | A line, not `EmptyState` (only a whole empty tab gets the glyph) | Nothing said | One muted line |
| Search (B) | Integrations' `.settings-search-well` | — | Same well |

One more mismatch sits outside this page: Profile draws the account with a
bare `.account-avatar` image rather than `ActorMark` (decision 6).

## 3. The directions

**A · One page, in Profile's and Integrations' shape.** The page keeps its
one sidebar entry and becomes five groups, one kind of thing each:

1. **Identity**: Profile's row. It holds the 32px tile, the name, "6 members ·
   You're the owner", Rename, and the photo's acts in its ⋯.
2. **Members**: the face, the name with You, the email, the role in a column,
   and Remove in the ⋯.
3. **Invitations** (owners and admins): the inline form, then the pending
   invitations, each with an outline face, "Invited as Member · Expires in
   6 days", Copy link, and Cancel in its ⋯, or one line when there are none.
4. **GitHub**: Integrations' row, naming the account.
5. **Leave**: last, in its own group.

A needs no service change.

**B · General and Members, two pages.** The workspace's sidebar group gets
two entries:

- **General** holds the identity row, GitHub, and Leave.
- **Members** holds Integrations' search well with Invite… beside it,
  Invitations, and the members. Each role is a field chip whose menu picks
  Member or Admin and, past a rule, removes the person. Invite… is the
  confirm dialog with a field, as New workspace asks.

B's role chip needs a role-change route the service doesn't have.

## 4. The pick: A

A meets Dean's bar with nothing new: every row is one Settings already
draws, the page stays one per sidebar entry, it needs no service change, and
it fixes all twelve findings. B is the better page at Linear's scale. A
workspace on Luke has a handful of members, so search is chrome, and B's
chip only earns its place with a route the service doesn't have. If role
changes are wanted, they fit in A's ⋯ as "Make admin" / "Make member",
where Linear and Slack put them.

## 5. PR plan (A)

| # | PR | Size |
|---|---|---|
| 1 | **fix(desktop)**: the page's small mismatches. You in `.actor-card-name`; no Remove on your own row; "The members could not be read."; invitations get the outline face and their expiry. Each with a test that fails without it. | S · ~150 |
| 2 | **feat(desktop)**: Settings › Workspace in Profile's and Integrations' shape. The identity row replaces Your role, Name, and Photo. The role becomes a column. Invitations get their own group. GitHub names its account. Leave moves last. `TILE_SIZE.SETTINGS` is deleted, and the sidebar row becomes "Workspace". The search anchors keep landing. | M · ~350 |
| 3 | **fix(desktop)**: Profile draws the account on `ActorMark`. | S · ~60 |
| 4 | *(if decision 2 is yes)* **feat(service,desktop)**: an owner or admin changes a member's role. A route and its store query, with its sibling test including the cross-account read, `ACT_KIND.WORKSPACE_MEMBER_ROLE`, and the ⋯ items. | M · ~400 |

PR 1 stands alone. PR 2 builds on it. PR 3 is independent.

## 6. Decisions for Dean

1. **A or B.** *Recommended: A.*
2. **Role changes**, which don't exist today: (a) not now; (b)
   *recommended:* PR 4, in A's ⋯. Also choose whether an admin may make
   another admin, or only the owner.
3. **The page's title.** *Recommended:* keep the workspace's name (#2764),
   though the identity row repeats it. The row is where Rename and the photo
   live, as Profile's title is "Profile" and its row is the account.
4. **The sidebar entry's name.** *Recommended: "Workspace"* (B: "General"
   and "Members").
5. **Delete workspace**, which has no act. *Recommended: not in this work.*
   It would later join Leave's group as the row below it, asking by name.
6. **Profile on `ActorMark`** (PR 3). *Recommended: yes.*
