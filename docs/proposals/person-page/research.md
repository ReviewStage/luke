# Research: how comparable tools represent a person

For `docs/proposals/person-page.md`. Gathered 2026-10-15. Each claim carries
its source. Where an official page didn't say, the source is a forum or
third party and is marked so.

## Summary

| Tool | Where you get there | What's on it | What's private | Click yourself |
|---|---|---|---|---|
| Linear | An avatar in the activity feed, `O` `U`, or the command menu | Assigned issues; online status and last seen | Guests see no other teams; private teams hidden; suspended users kept | Your profile, with edit |
| GitHub | Hovercard, then the profile | README, contributions, pinned repos, orgs; contextual hovercard lines | Private contributions anonymized; org membership private by default | The same profile |
| Slack | Hover card, then click for the profile panel; Directories › People | Title, local time, status, contact, About; Message | Admin-chosen fields; external people see name and photo | Your profile, then Edit |
| Notion | Hover card, then click | Working on, collaborators, teamspaces, recent activity | Guests get none; owners can turn it off | Your profile; edits in Settings |
| Figma | View profile from a name, the People filter, or a link | Teams, folders, recent files | Only what the viewer can open; email hidden | Same, plus drafts and email |
| Asana | Click a name or photo, a mention, or search | Teams, projects, tasks, collaborators | Public tasks and your collaborations only | Your profile |
| Atlassian | Hover card, then profile; board avatars filter | Title, department, local time, Works with | Per-field visibility; "Former user" | Edit at id.atlassian.com |
| Vercel | No page; Deployments filter by author | Members rows | Owners manage | n/a |
| Devin, Cursor, Height | No page; creator filters, admin tables | Counts in admin analytics | Admin only | n/a |
| Conductor | Click a teammate's avatar (0.91) | Daily token heatmap; Pokes | Shared org | Not documented |

## Linear

- Another user's profile: "Select a user to open their profile, then use the
  Assigned tab to see their issues." https://linear.app/docs/custom-views
- Assigned, Created, Subscribed and Activity are documented as My Issues tabs.
  https://linear.app/docs/my-issues
- The profile shows online, away or offline status, and "the time they've last
  been online." https://linear.app/changelog/2020-04-27-improved-my-issues-view
- Your own profile gained an edit option.
  https://linear.app/changelog/2020-06-09
- You get there with `O` then `U`, or by "clicking on a user's avatar in the
  activity feed". https://linear.app/docs/custom-views
- Clicking an assignee avatar on a card opens the assign menu, not the
  profile. https://linear.app/docs/assigning-issues
- Filters include Assignee and Created by. Suspended users can't be filtered;
  you go to their profile instead. https://linear.app/docs/filters
- Suspended users stay "for historical purposes", and guests see no other
  teams. https://linear.app/docs/members-roles,
  https://linear.app/changelog/2022-07-14-guest-accounts

## GitHub and GitLab

- The GitHub profile has a README, contribution graph and timeline, pinned
  items, status, achievements and organizations.
  https://docs.github.com/en/account-and-profile/concepts/personal-profile
- Private contributions show as anonymized counts, and visitors without
  access "will not see specific details."
  https://docs.github.com/en/account-and-profile/reference/profile-contributions-reference
- Hovercards add context: "which teams they belong to in your organization",
  "code owner", and "first pull request".
  https://github.blog/news-insights/the-library/user-hovercards/ and
  https://docs.github.com/en/rest/users/users#get-contextual-information-for-a-user
- Org membership is private by default and visible to fellow members.
  https://docs.github.com/articles/about-organization-membership,
  https://docs.github.com/en/rest/orgs/members
- A deleted account's work moves to a shared ghost user.
  https://github.com/github/docs/blob/main/content/account-and-profile/setting-up-and-managing-your-personal-account-on-github/managing-your-personal-account/deleting-your-personal-account.md
- An unlinked commit author is "not linked to any user".
  https://docs.github.com/en/pull-requests/committing-changes-to-your-project/troubleshooting-commits/why-are-my-commits-linked-to-the-wrong-user
- GitHub filters by person with qualifiers (`author:`, `assignee:`,
  `involves:`), not by clicking an avatar.
  https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/filtering-and-searching-issues-and-pull-requests
- GitLab's profile has status, local time, a contribution calendar and
  activity tabs. A popover on a name shows local time and Busy. Your own
  profile has an "Edit profile" door. https://docs.gitlab.com/user/profile/

## Slack, Discord and Atlassian

- Slack: click a colleague's name and "their profile card pops up on the
  right-hand side." https://slack.com/blog/collaboration/employee-profile
- Slack's hover card offers a DM, huddle or call, and clicking it opens the
  full profile. https://slack.com/blog/news/profile-updates-hybrid-work-teams
- Slack: people from another organization see name and photo by default.
  https://slack.com/help/articles/4417558556691
- Slack: deactivation "does not delete profile information".
  https://slack.com/help/articles/204475027
- Slack: you reach your own profile from your sidebar picture, then Profile ›
  Edit. https://slack.com/help/articles/204092246
- Discord: clicking a name opens a popout, then the full profile, which shows
  mutual servers and friends and a private note. This comes from a university
  guide, not Discord's own docs.
  https://support.cci.drexel.edu/getting-connected/discord/discord-view-user-profiles/
- Atlassian: hovering a name shows a profile card "with more information and a
  link to the user's profile".
  https://confluence.atlassian.com/cloud/blog/2020/01/atlassian-cloud-changes-dec-30-to-jan-6-2020
- Atlassian: a "Works with" section lists collaborators. Atlassian warns it
  can reveal a relationship between people even when the viewer can't see the
  shared items.
  https://support.atlassian.com/atlassian-account/docs/manage-your-personal-profile/
- Atlassian: a deleted user becomes "Former user".
  https://support.atlassian.com/confluence-cloud/docs/what-happens-when-an-account-is-deactivated-vs-deleted/
- Jira: a board's avatars filter to that assignee. Community posts only:
  https://jira.atlassian.com/browse/JWMCLOUD-420

## Notion, Figma, Vercel, Asana, Height

- Notion: the hover card shows "what they're working on". The profile shows
  "top collaborators", "teamspaces they belong to" and "recent activity in your
  workspace". Guests get neither, and owners can turn both off.
  https://www.notion.com/help/people-profiles
- Figma: an internal profile shows teams, folders and "recent file
  contributions", cut to what the viewer can access. Email is hidden from
  others, and your own profile adds drafts and email.
  https://help.figma.com/hc/en-us/articles/360039957614-View-internal-profiles
- Figma's admin People tab shows "Last active".
  https://help.figma.com/hc/en-us/articles/4420842863255-View-members-and-guests
- Vercel has no member page. Deployments filter by author, and the filter
  persists in the URL. https://vercel.com/changelog/filter-deployments-by-author,
  https://vercel.com/docs/rbac/managing-team-members
- Asana: user profiles show "teams, projects, tasks and collaborations", and
  clicking a name opens one. Asana forum:
  https://forum.asana.com/t/introducing-user-profiles/203379
- Asana: you "only see public tasks and tasks you are a collaborator" on.
  Asana forum: https://forum.asana.com/t/view-other-peoples-tasks/83318
- Height shut down in September 2025 and had no person page. People were
  filters, such as `Q` for tasks assigned to you.
  https://height.app/blog/march-4th-2020,
  https://alternativeto.net/news/2025/3/height-project-management-tool-to-shut-down-by-september-2025/

## Cursor, Devin, Conductor

- Cursor has no teammate page. People appear in admin analytics and a
  leaderboard every member can see. https://cursor.com/docs/account/teams/analytics
- Devin: sessions filter by creator, and the sidebar defaults to "sessions
  that you started". https://docs.devin.ai/release-notes/2024,
  https://docs.devin.ai/release-notes/2026
- Conductor 0.91.0 (2026-10-15): "click a teammate's avatar to open their
  profile", and "Removed the Team page. Teammate profiles replace it."
  https://www.conductor.build/changelog/0.91.0-a-mostly-boring-update
- Conductor's Home filters by person through its By filter.
  https://www.conductor.build/docs/cloud/collaboration

## Patterns to copy

- Two levels: a card on hover, a page on click.
- A page is cut to what the viewer can already open.
- Your own page is the same page with an edit door, not Settings.
- A former member keeps a label and their history.
- A person filter is a secondary action, not the press.

## Patterns to avoid

- Per-person usage, last active, or online state outside admin views.
- "Works with" style aggregation that reveals relationships.
- A press that rewrites the list you were reading.
