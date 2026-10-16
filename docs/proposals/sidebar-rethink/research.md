# Grouping, sorting and filtering a sidebar of many work items

This is the research behind `docs/proposals/sidebar-rethink.md`. Each claim is
followed by the URL it came from. "(unverified)" means no fetched source
confirmed it, so treat those lines as recollection. Researched 2026-10-15.
help.openai.com, Arc's help centre and Superhuman's help centre refused direct
fetches. Those pages were read through a reader proxy or the help centre's
public API, at the URLs cited.

The questions asked of every product:

- **Pinned.** Where do pinned items live, and is that a fixed section apart from the grouping?
- **Archived.** Is archived a group in the list, or a place of its own?
- **Grouping.** Is it fixed, or chosen by the user?
- **Mine.** How does "mine" show on a list the team shares?
- **Scope.** Where is a view choice remembered?

## 1. Linear

**Sidebar**
- Inbox and My issues are fixed sidebar items. https://linear.app/docs/inbox, https://linear.app/docs/my-issues
- "Once you add your first favorite, the Favorites section appears in your sidebar above Your Teams." https://linear.app/docs/favorites
- The teams you belong to are listed in the sidebar. Each one has Issues, Projects and Views. https://linear.app/docs/teams
- The sidebar can be personalized: items reordered, or moved behind "More". https://linear.app/changelog/2024-12-18-personalized-sidebar

**Display options**
- Grouping is chosen per view: status, assignee, project, priority, cycle and more, or "No grouping". https://linear.app/docs/display-options
- Ordering can be Status, Manual, Priority, Last created, Last updated, Due date or Link count. https://linear.app/docs/display-options
- Display properties choose what each row shows, such as ID, assignee or project. https://linear.app/docs/display-options
- Display options are saved per user and "will persist even if you navigate away". "Set as default" applies them to the whole workspace. https://linear.app/docs/display-options

**Filters**
- Filters include Created by and Assignee, among others. On a shared team list, "mine" is one of these filters. https://linear.app/docs/filters
- My issues has tabs for Assigned, Created, Subscribed and Activity. https://linear.app/docs/my-issues

**Archive**
- Archived issues are not shown in normal views. They live on each team's archive page, reached from the ⋯ beside the team in the sidebar (G then X). https://linear.app/docs/delete-archive-issues
- Completed and canceled issues stay in lists as the status groups that sort last. https://linear.app/docs/display-options

## 2. Cursor (agents)

All from https://cursor.com/docs/release-notes.md unless noted.

- The sidebar has a Pinned section at the top (3.21, 3.22), repository sections (3.21), and a No Repo section with a Chats header (3.23).
- Projects are their own sidebar entries. https://cursor.com/docs/agent/projects.md
- Grouping is fixed. Web agents are grouped into "Today, Last 7 days, and an Older section that starts collapsed" (week of 2026-09-28).
- Failed agents get their own Error group, with an "Error option under Show > Status" (3.22).
- Archive works per agent or as "Archive All" per group (3.20). Where archived agents are viewed is unverified.
- "Chats that wake up in the background move up in the sidebar" (3.22).
- Pins are kept on the account, "across windows and devices" (3.21).

## 3. Windsurf / Devin Desktop

- "The sidebar lists every session in the workspace… Filter, sort, and group sessions per workspace, with grouped spaces keeping a sticky header." https://docs.devin.ai/desktop/agent-command-center.md
- v3.6.21 added "per-workspace filters/sort/grouping". https://docs.devin.ai/desktop/changelog

## 4. Conductor

- A cloud organization's sidebar has **Pinned** and **My workspaces** sections. "Choose a person under Team to open Home filtered to their workspaces." https://www.conductor.build/docs/cloud/collaboration
- Home's filters are "By: choose a teammate or Anyone. In: choose one or more projects. Archived: show or hide archived workspaces." https://www.conductor.build/docs/cloud/collaboration
- Archived workspaces leave the sidebar and are restored from the History pane. https://www.conductor.build/docs/concepts/workflow

**Changelog**

| Version | Change | Source |
| --- | --- | --- |
| 0.35 | Grouping by status, then by repository | https://www.conductor.build/changelog/page/9 |
| 0.54 | "Sort workspaces by created or updated time" | https://www.conductor.build/changelog/page/5 |
| 0.75 | Removed "sidebar grouping mode", and added a "Show archived toggle" on the Workspaces page | https://www.conductor.build/changelog/page/3 |
| 0.78 | "Archived workspaces no longer appear in Pinned" | https://www.conductor.build/changelog/page/3 |
| 0.80 | "Filter workspaces by person from avatar stacks" | https://www.conductor.build/changelog/page/2 |
| 0.85 | User-made sections | https://www.conductor.build/changelog/page/2 |
| 0.86 | "Only archived" filter | https://www.conductor.build/changelog/page/2 |

## 5. OpenAI Codex app

- The sidebar has Pinned, Projects and Recents. https://developers.openai.com/codex/app/features
- "Pin a project to keep it near the top of the sidebar… Pin a chat when you return to it often." https://developers.openai.com/codex/projects
- Grouping is a choice: "select the filter icon next to Chats, then select Chronological." https://developers.openai.com/codex/app/troubleshooting
- Archive lives in Settings, not the sidebar. "The Archived chats section lists archived chats with dates and project context." https://developers.openai.com/codex/app/settings
- "When you unarchive a chat, it reappears in its original sidebar location." https://developers.openai.com/codex/app/troubleshooting
- 26.417 made sidebar sections collapsible. https://developers.openai.com/codex/changelog/

## 6. Devin (web)

All from https://docs.devin.ai/release-notes/2026 unless noted.

- Sections are Recents and Archived (2026-10-14), a Pinned folder (09-30), and personal folders (06-12).
- Grouping is chosen by the user: "group sessions by pull request status or by repository" (09-02). Group by status uses Working, Ready, Blocked and Inactive (09-25). "None" gives "a flat session list" (08-12).
- "Sessions can now also be sorted by creation date" (02-20).
- "Mine" is the default. "By default, sessions in your sidebar are filtered to non-archived sessions that you started… 'Save as Default'". https://docs.devin.ai/release-notes/2024
- View choices follow the account: "session list display options… follow your account" (10-02). Folder folds are "persisted per organization" (05-17).

## 7. Claude.ai and ChatGPT

**Claude.ai**
- Starred projects appear in the left side panel. https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects
- Archived projects sit at the bottom of the projects list and in an archived tab of the Projects page. https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects

**ChatGPT**
- "Your Pinned section now includes both chats and projects. You can also organize Recents as one combined list, or group chats by project" (2026-06-18). https://help.openai.com/en/articles/6825453-chatgpt-release-notes
- Archived chats leave the sidebar for Settings › Data controls › Archived chats. https://help.openai.com/en/articles/8809935-how-to-delete-and-archive-chats-in-chatgpt
- In a shared project, "each chat shows the profile icon of the person who created it". https://help.openai.com/en/articles/10169521-projects-in-chatgpt

## 8. Notion

- The Home tab has sections including Recents, Favorites and Agents, plus Teamspaces, Shared and Private. https://www.notion.com/help/navigate-with-the-sidebar
- A section's `•••` offers Show (how many items), Move up or down, and Hide. Private and Shared sort by Manual or Last edited. https://www.notion.com/help/navigate-with-the-sidebar
- Favorites is its own section, apart from where a page lives. https://www.notion.com/help/customize-your-sidebar
- Trash is a separate view. https://www.notion.com/help/navigate-with-the-sidebar
- The setup is per user: "Your sidebar setup is yours alone." https://www.notion.com/help/customize-your-sidebar

## 9. Slack

- Starred is a section that "will appear in your sidebar after you star a channel or DM for the first time". https://slack.com/help/articles/201331016-Star-channels-and-direct-messages
- "Each section can have its own filters and sorting": A–Z, Recency or Priority, set from the section's ⋯. https://slack.com/intl/en-gb/help/articles/360043207674-Organise-your-sidebar-with-customised-sections
- The sidebar's filter defaults to "Active only". https://slack.com/help/articles/212596808-Set-your-sidebar-preferences
- Sections are personal: "Your custom sections are only visible to you." https://slack.com/help/articles/360043207674-Organize-your-sidebar-with-custom-sections

## 10. Things 3

- The predefined lists are Inbox, Today, Anytime, Upcoming, Someday, Logbook and Trash. Areas and projects are the user's own. https://culturedcode.com/things/support/articles/4562654/
- Completed items go to the Logbook, a separate view. https://culturedcode.com/things/support/articles/4001304/
- Tags filter a list from the filter bar at its top, and "All" clears the filter. https://culturedcode.com/things/support/articles/2803581/

## 11. GitHub Desktop

- "Repositories are now grouped by owner", with the most recent at the top for users with more than six repositories. This grouping is fixed. https://github.blog/changelog/2019-06-05-github-desktop-2-0-release/

## 12. Arc

- "Favorites show at the very top of the Sidebar, above your Space Titles." https://resources.arc.net/hc/en-us/articles/19230755904151-Favorites-Top-Tabs-Across-Every-Space
- Each Space has a Pinned section and an Unpinned (Today) section. https://resources.arc.net/hc/en-us/articles/19228064149143-Spaces-Distinct-Browsing-Areas
- Archived tabs are a separate view, reached from ⌘T › View Archive. https://resources.arc.net/hc/en-us/articles/19228855311127-Auto-Archive-Clean-as-you-go

## 13. Apple Mail and Jira, briefly

- Mail's Filter button applies Unread by default, and applies to the current mailbox only. https://support.apple.com/guide/mail/mlhl1f6cf15a/16.0/mac/15.0
- Jira's preset filters include "My open work items" and "Reported by me". https://support.atlassian.com/jira-software-cloud/docs/manage-filters/
- Jira's sidebar customization "is personal to your account". https://support.atlassian.com/jira-software-cloud/docs/what-is-the-new-navigation-in-jira/

## What the products agree on

| | Pinned or favourites | Archived | Grouping | Mine | Kept |
| --- | --- | --- | --- | --- | --- |
| Linear | A section above the teams | A team's archive page | Chosen per view | A filter, and My issues | Per user |
| Cursor | A section at the top | Unverified | Fixed: repository, then date | Not documented | Pins on the account |
| Conductor | A section at the top | The History pane; a filter on Home | Fixed today (a mode was removed) | My workspaces; a By filter | Unverified |
| Codex | A section at the top | Settings | Projects or Chronological | Not applicable | Unverified |
| Devin | A Pinned folder | An Archived section | Chosen: repository, PR status, status, None | The default filter | On the account |
| ChatGPT | A section at the top | Settings | One list or by project | Creator's icon in shared projects | Unverified |
| Notion | Favorites section | Trash view | Sort per section | Not applicable | Per user |
| Slack | Starred section | Not applicable | Sort per section | Not applicable | Per user |
| Arc | Favorites at the very top | A separate view | Spaces | Not applicable | Synced, except Favorites |

**Unverified.** These could not be confirmed from any fetched source:
- whether Cursor's archived agents have a view of their own;
- what Windsurf's filter, sort and group options are;
- whether Conductor's repository grouping survived 0.75;
- Codex's sort options beyond Chronological;
- a Devin "created by" filter for anyone other than you;
- Slack's per-section "Unreads only" filter.
