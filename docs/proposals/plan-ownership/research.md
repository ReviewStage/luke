# Telling mine from a teammate's: how six products do it

Research for a "my plans vs a teammate's plans" indicator in a desktop sidebar of
documents grouped by repository. Each claim is followed by the URL it came from.
"(unverified)" means no fetched source confirmed it; treat those as recollection.
Researched 2026-10-15.

## 1. Linear (issues and projects)

**Who is shown**
- An issue has exactly one assignee: "Issues in Linear are assigned to a single person
  at a time, giving teams clear ownership and responsibility." An agent can be delegated
  while a human stays the assignee. https://linear.app/docs/assigning-issues.md
- The creator is a separate, fixed fact. Any member can edit an issue's title and
  description "regardless of who is the original creator of an issue". Only a comment's
  author can edit that comment. https://linear.app/docs/editing-issues (via Linear's docs search)
- A project has a single **Lead** ("Limited to one member of your workspace") plus
  **Members** ("Add anyone from the workspace"). https://linear.app/docs/project-overview
  The docs say "We have a single lead field to keep ownership of the project clear."
  https://linear.app/docs/projects.md
- Custom views have an **owner** that "defaults to the creator of the view but can be
  changed to other users". This is the clearest example of creator becoming a
  transferable owner. https://linear.app/docs/custom-views
- The Jira sync maps Linear's "Creator" to Jira's "Creator/Reporter", so Linear stores the
  creator as its own field. https://linear.app/docs/jira

**How it is drawn in lists**
- The assignee is shown as an avatar on list rows and board cards. You can reassign "by
  clicking the assignee avatar". https://linear.app/docs/assigning-issues.md
- Assignee is a display property you can show or hide. The documented display-property
  list (ID, status, assignee, priority, …, created date, updated date) has **no creator**
  property. https://linear.app/docs/display-options
- The avatar sits at the right end of the row and appears on every row, including your
  own (unverified; no doc states the position).

**Filters and views**
- My issues has four tabs: "Issues assigned to you, created by you, to which you are
  subscribed, and issues with recent activity". Created issues include ones made through
  integrations (Slack, support tools). You are automatically subscribed to issues you
  created, are assigned to, or are @mentioned in. https://linear.app/docs/my-issues
- The filters include both **Assignee** and **Created by** (quick filter "Created by |
  Username"), plus **Subscriber**. https://linear.app/docs/filters.md
- You can **group issues** by status, assignee, project, priority, cycle, label, parent,
  team, customer, release, or SLA, but **not by creator**. You can group **projects** by
  lead or member. https://linear.app/docs/display-options
- Each user's profile has an Assigned tab. https://linear.app/docs/custom-views

**Moving an issue to another team**
- Moving gives the issue a new ID and URL, and old URLs redirect. Cycle may be cleared,
  team labels and projects are removed, relations and priority stay, and status is
  remapped. https://linear.app/docs/editing-issues
- The table of changed properties does not list creator or assignee, which suggests both
  survive the move. No doc says so outright (creator retention unverified).

## 2. Notion (pages in teamspaces)

**Who is shown**
- Database properties include **Created by** ("Automatically records the person who
  created the item") and **Last edited by**. Both are automatic and not editable. A
  separate **Person** property is editable. https://www.notion.com/help/database-properties
- Pages have no general owner. Wikis add one: whoever creates a wiki page owns it by
  default, but "you can change the page owner at any time". In a database the Owner
  property can be limited to one person or unlimited, and its default can be the creator
  or none. https://notion.com/help/wikis-and-verified-pages
- Notion's guide to keeping team pages current recommends showing Created by and "Last
  updated by" as database properties.
  https://www.notion.com/vi/help/guides/tips-to-keep-your-teams-notion-pages-up-to-date

**How it is drawn**
- The sidebar groups pages by **where they live and who can see them**: Teamspaces,
  Shared ("pages that you've shared with select individuals"), and Private ("only visible
  to you"). https://www.notion.com/help/navigate-with-the-sidebar
- Sidebar rows show icon and title only, with no creator avatar (unverified; the help page
  doesn't mention avatars). The creator appears only where a database view shows the
  Created by property (https://www.notion.com/help/database-properties).

**Filters and views**
- Search has a **Created by** filter ("content created by one or more people in your
  workspace") alongside Teamspace, In, and Date. https://www.notion.com/help/search?id=987939
- Inbox gathers "revisions that were made on pages you have created", so Notion uses
  authorship for notifications as well as attribution.
  https://www.notion.com/en-gb/help/home-and-my-tasks
- No "Created by me" view in the sidebar or Library was found (unverified absence).

**Moving**
- Dragging a page from Teamspaces or Shared into Private changes who can see it: "others
  will lose access". https://www.notion.com/help/navigate-with-the-sidebar
- Created by is described as automatic and not editable, so it should stay fixed through
  a move (unverified for moves specifically).

## 3. Figma (team files)

**Who is shown**
- "The person who creates a file or folder is considered the owner." Only the current
  owner can transfer ownership. A file has one owner.
  https://help.figma.com/hc/en-us/articles/360038512093-Transfer-ownership-of-files-or-folders
- The REST API's file metadata includes the viewer's `role` (owner/editor/viewer) and
  `last_touched_by` with a profile image URL (third-party summary of the API, so treat
  with caution). https://aident.ai/actions/figma_tools/figma_get_file_metadata

**How it is drawn**
- Files appear as thumbnail cards or in a list view. Figma removed list view in a March
  2025 redesign and restored it after user pushback.
  https://forum.figma.com/report-a-problem-6/list-view-missing-from-new-file-browser-update-38952
- Users have asked for more list columns, including "last modified by me/anyone"; no sign
  it was built. https://forum.figma.com/archive-21/add-columns-to-recently-viewed-and-project-table-pages-20809
  (summarised in a search result; the page itself returned 403)
- Whether cards show an owner or last-editor avatar is unverified.

**Filters and views**
- Recents "shows the files you've viewed most recently". Drafts are "your personal
  sketchbook". https://help.figma.com/hc/en-us/articles/30926159906967-FD4B-Tour-the-file-browser-and-customize-your-profile
- Search can be filtered "by resource type, file creator, or file location", and results
  can be sorted by Created. Creator is a search filter, not a list column.
  https://help.figma.com/hc/en-us/articles/4422774037271
- In Figma, "mine" means **location**: Drafts holds your own files and are private to you
  unless shared. https://help.figma.com/hc/en-us/articles/18409526530967-Updates-to-how-drafts-work

**Transfer and move**
- Transferring ownership "doesn't move the file" and doesn't change your own access. A
  draft can go to anyone you've shared it with. A file in a folder can only go to an
  existing collaborator.
  https://help.figma.com/hc/en-us/articles/360038512093-Transfer-ownership-of-files-or-folders
- Moving a file from drafts to a folder changes who can access it (the destination
  folder's people now have access). The article doesn't say the owner changes, so
  ownership and location are independent. https://help.figma.com/hc/en-us/articles/360038511573

## 4. Google Docs / Drive

**Who is shown**
- **Owner** is the main fact. A separate `creator:` search operator exists for
  **shared drives** ("Find documents in shared drives created by a specific person").
  There the organization owns the file, so the creator is the only person-level fact
  left. https://support.google.com/drive/answer/2375114
- When you move a file into a shared drive, "the ownership changes from the individual to
  the team". https://uit.stanford.edu/service/gsuite/shareddrives/migratefiles

**How it is drawn**
- Shared with me lists the date shared, "The owner of the file", and the document type,
  newest first. https://support.google.com/drive/answer/2375057?hl=en
- In list view the Owner column can be swapped for another column (old, third-party
  source). https://alicekeeler.com/2014/03/15/google-drive-folders-options/
- The Owner column shows "me" for files you own and a name for others' files
  (unverified; not confirmed by any fetched source).

**Filters and views**
- Search filter chips: Type, People, Modified. https://support.google.com/drive/answer/2375114
- The People chip offers "Is owned by", "Is created by", and "Is shared by".
  https://www.popsci.com/diy/google-drive-search-chips/
- The Owner filter's options are Anyone, Owned by me, Not owned by me, and Specific person
  (school IT guide, not Google). https://lisd.helpjuice.com/filtering-in-google-drive-online
- Search operators include `owner:`, `creator:`, `pendingowner:`, and `owner:me` (e.g.
  `is:unorganized owner:me`). https://support.google.com/drive/answer/2375114

**Transfer**
- Ownership changes only if the recipient accepts. They are upgraded to Editor while the
  request is pending. Once they accept, the old owner is "downgraded to Editor" and "The
  new owner can remove you". Work accounts can transfer only within the organization.
  https://support.google.com/drive/answer/2494892
- If someone deletes a folder you created a file in, the file is not deleted. It moves
  to your My Drive (`is:unorganized owner:me`). https://support.google.com/drive/answer/2375114

## 5. GitHub (issues and pull requests)

**Who is shown**
- Author is fixed. Assignees, mentions, and review requests are separate relationships.
  `author:@me`, `assignee:`, `mentions:`, `review-requested:`, and `involves:` (an OR of
  author, assignee, mentions, and commenter) all accept `@me`.
  https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests

**How it is drawn**
- I checked the markup of a live repository PR list (`github.com/cli/cli/pulls`,
  2026-10-15). Each row's data carries `author.displayLogin` and an author association,
  but **no author avatar URL**. A row names its author as login text, on every row,
  including your own (observed; the rendered "opened … by login" wording itself is
  unverified). https://github.com/cli/cli/pulls
- Assignee avatars at the right of a row, with an avatar stack for several assignees
  (unverified).

**Filters and views**
- The issues dashboard (github.com/issues) has **Created by me**, **Assigned to me**,
  **Mentioned**, and **Recent activity** views.
  https://github.blog/changelog/2025-04-02-github-issues-dashboard-updates/
- The new pull-requests dashboard (GA July 2026) has smart filters **Authored by me**,
  **Assigned to me**, **Involves me**, and **Review requested**, plus an Inbox of PRs
  needing your attention. "The `author` filter now includes agent-created pull requests."
  https://github.blog/changelog/2026-07-09-new-pull-requests-dashboard-is-now-generally-available
- The classic github.com/pulls had Created (default), Assigned, and Mentioned tabs.
  https://code-maven.com/github-pull-requests-waiting-for-me

**Transferring an issue to another repository**
- "comments and assignees are retained". Labels and milestones carry over only if they
  match in the target repository. The old URL redirects. The article doesn't mention
  the author, which in practice stays the original opener (unverified).
  https://docs.github.com/en/issues/tracking-your-work-with-issues/administering-issues/transferring-an-issue-to-another-repository

## 6. Slack (channels, canvases, lists)

**Who is shown**
- "When someone creates a channel, they're automatically assigned as the channel
  manager." Managers (up to 100) are listed under "Managed by" on the About tab and can
  be added or removed there. Creator becomes a role that can change.
  https://slack.com/intl/en-sg/help/articles/8328303095443-Understand-channel-managers-in-Slack
- Canvases have owners: "You can delete canvases that you created or that you own", and
  edit-access requests go "to the canvas owner(s)". https://slack.com/help/articles/203950418

**How it is drawn and filtered**
- The canvases list lives under Home → Files → Canvases and covers canvases you created or
  can view or edit. https://slack.com/help/articles/203950418
- An older version of Slack's canvas article described a Filter for "Created by you,
  Shared with you or All". The URL now redirects, and the current article doesn't repeat
  it (historical; current UI unverified). https://api.slack.com/help/articles/4416442287251
- Sidebar custom sections "are only visible to you". You organize conversations by your
  own grouping, not by who made them. https://slack.com/help/articles/360043207674
- The channel browser shows who created each channel (unverified; the claim is attributed
  to GitLab's handbook but couldn't be found on the fetched page).

**Transfer**
- Canvas or list ownership can be reassigned **only when the owner is deactivated**. All
  eligible items go at once, and items created by guests are excluded.
  https://slack.com/intl/en-gb/help/articles/19584367202579-Reassign-canvas-or-list-ownership

## Mine by absence

- iMessage group chats show the sender's name and avatar only on others' messages. Your
  own are right-aligned and blue with no avatar (unverified; Apple's guides don't
  describe it).
- None of the six products marks **your own** items by leaving off an indicator. Linear
  (assignee avatar) and GitHub (author login) draw the same thing on every row, yours
  included (Linear placement unverified). Drive's "me" in the Owner column (unverified)
  labels yours explicitly rather than leaving it blank.
- "Mine" is more often a **place or a view** than a row marker: Figma Drafts, Notion
  Private, Linear My issues, GitHub's Authored by me, and Drive's Owned by me.

## Patterns for "my plans vs a teammate's plans"

- **Keep two facts: a creator that never changes, and an owner that can.** Linear issues
  (creator, assignee), Linear views (owner defaults to creator), Notion wikis (owner
  defaults to creator), Drive shared drives (`creator:` vs `owner:`), and Slack channels
  (creator becomes the first manager) all separate the two. Figma and Drive's My Drive
  merge them, then need a transfer flow to cope.
- **Name the relationship, not just "mine".** Every product with a "me" filter splits it
  into created, assigned, mentioned, subscribed, or owned. A plan likely needs at least
  "started by me" and "a teammate's" now, with room for "assigned to me" later.
- **Show a person on rows only where people vary.** Linear and GitHub mark every row
  because one list mixes many people. Notion's sidebar and Figma's Drafts mark nothing,
  because the section already says whose it is. In a sidebar grouped by repository, where
  most plans are probably the user's, the cheaper choice is to mark teammates' rows only
  (a small trailing avatar). No source shows a product doing this for documents, so it
  would be a deliberate departure.
- **Put the avatar at the trailing edge, small, and outside the title.** Linear's assignee
  avatar is a row-level control at the end of the row (placement unverified), and GitHub
  gives the author as secondary text. Neither puts the person ahead of the title.
- **Back the row marker with a filter or section.** Every product that shows people on
  rows also has a "Created by me" / "Authored by me" / "Owned by me" control. A row
  marker on its own doesn't let the user hide teammates' plans.
- **Grouping by creator is rare.** Linear groups issues by assignee but not creator, and
  groups projects by lead. If plans are grouped by repository, author belongs in a filter
  or row marker, not as a second grouping axis.
- **A transfer needs a consent step.** Drive's pending owner must accept, Figma's
  recipient must already be a collaborator, and Slack lets admins reassign only when the
  owner is deactivated. The old owner usually keeps access (Drive: downgraded to Editor;
  Figma: access unchanged).

## Transfer and move: summary

| Product | Fixed creator? | Transferable owner? | Moving between containers |
| --- | --- | --- | --- |
| Linear issue | Yes, a "Created by" field (https://linear.app/docs/filters.md) | Assignee, one at a time | New ID; old URL redirects; creator not listed as changed (https://linear.app/docs/editing-issues) |
| Linear project/view | Not documented for projects | Project lead (single); a view's owner defaults to its creator and can be changed (https://linear.app/docs/custom-views) | n/a |
| Notion | Created by: automatic, not editable (https://www.notion.com/help/database-properties) | Wiki Owner, changeable (https://notion.com/help/wikis-and-verified-pages) | Moving into Private removes others' access (https://www.notion.com/help/navigate-with-the-sidebar) |
| Figma | No separate creator; creator becomes owner | Yes; the owner transfers, the recipient must be a collaborator (https://help.figma.com/hc/en-us/articles/360038512093) | Moving changes access, not owner; transferring doesn't move the file |
| Google Drive | `creator:` in shared drives (https://support.google.com/drive/answer/2375114) | Yes; recipient must accept; old owner becomes Editor (https://support.google.com/drive/answer/2494892) | Moving into a shared drive hands ownership to the team (https://uit.stanford.edu/service/gsuite/shareddrives/migratefiles) |
| GitHub issue | Author (assumed kept on transfer, unverified) | Assignees, kept on transfer | Transfer to another repository keeps comments and assignees; URL redirects (https://docs.github.com/en/issues/tracking-your-work-with-issues/administering-issues/transferring-an-issue-to-another-repository) |
| Slack | Channel creator becomes first manager (https://slack.com/intl/en-sg/help/articles/8328303095443) | Managers editable; canvas owner reassignable only after deactivation (https://slack.com/intl/en-gb/help/articles/19584367202579) | n/a |

What this means for plans: keep `createdBy` fixed from creation, and treat the "whose plan
is this" marker as an owner field that defaults to the creator. A move between
repositories should change neither field, as with Linear's team moves and Figma's file
moves. A transfer between people should be a separate, consented act that leaves the
previous owner with access.
