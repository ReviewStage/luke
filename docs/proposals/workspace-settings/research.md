# Workspace / team settings: how polished devtools lay it out

Researched 2026-10-15 from public docs, help-center articles, and changelogs (listed under Sources).
Labels in **bold** are UI strings the docs quote. Anything marked *(inferred)* comes from general
product knowledge or from how a doc is worded, not from a doc that states it. Docs rarely describe
visual styling such as cards, colours, or column widths, so most layout claims below stop at what the
docs say.

**Not documented by any product:** how the current user's own row is marked ("you"), or where the
member count is shown. *(inferred)* Most of these products put a "(you)" suffix or badge on your own
row and a count in the section heading or a tab label, but no fetched doc confirms it.

---

## Linear

- **Identity.** Admins edit the workspace "logo, name, and domain key" at Settings › Workspace (Administration) ([Workspaces](https://linear.app/docs/workspaces)). Your own avatar works the same way: click the photo, then **Change avatar**, then a file picker ([Profile](https://linear.app/docs/profile)). *(inferred)* Fields save on blur with no form-level Save button.
- **Structure.** The Dec 2024 redesign split settings into four groups: **Account**, **Features**, **Administration** (admins only), and **Your teams**. Team settings open as a single summary view, and you drill into a setting to edit it ([changelog](https://linear.app/changelog/2024-12-18-personalized-sidebar)).
- **Members.** Settings › Administration › Members. Since 2024 it is a "data-rich table" where you can "filter and sort any column", with added activity information ([changelog](https://linear.app/changelog/2024-12-18-personalized-sidebar)). Filters cover role and status: **Pending invites**, **Suspended**, and users who have left. You change a role by hovering the row, opening **⋯**, and choosing **Change role...**. Suspending works the same way: **Suspend user...** ([Members & roles](https://linear.app/docs/members-roles)). Suspended users stay in the list "for historical purposes", so the list doubles as a history.
- **Invites.** **Invite** on the Members page takes comma-separated emails, an **Invite as...** role (paid plans only), and optional teams, then **Send invites**. The reusable invite link and its **Reset invite link** button live under Settings › Administration › Security, not on Members ([Invite members](https://linear.app/docs/invite-members)). Pending invites are a filter on the Members table, not a section of their own.
- **Danger zone.** Owners delete the workspace from Settings › Workspace. The confirmation is a code sent by email. The workspace is then scheduled for deletion in 48 hours, every admin is emailed, and any admin can cancel during that window ([Workspaces](https://linear.app/docs/workspaces)). Leaving: once you leave, "an admin will have to unsuspend your account" before you can come back ([Profile](https://linear.app/docs/profile)).
- **GitHub.** The settings page has a **Connected organizations** list with a **+** to add another org. A separate banner appears when your personal account is not linked: "Connect your personal GitHub account to link issues with commits, PRs, and branches." The two connections are distinct: the workspace connects the org, and each member connects their own account ([GitHub](https://linear.app/docs/github)).
- **Non-admins** see only Account and their teams. A Member "cannot access workspace-level administration pages", and Guests see nothing beyond their Account tab. Anyone can open **View workspace admins** from ⌘K ([Members & roles](https://linear.app/docs/members-roles)).

## Vercel

- **Identity.** Team Settings › General holds the team avatar, name, and URL slug (the part of the URL after `vercel.com/`), followed further down by a copyable Team ID ([Accounts](https://vercel.com/docs/accounts), [CLI teams](https://vercel.com/docs/cli/teams)). The account-level version of the same pattern is documented: an **Avatar** section where you click the current image, crop, then **Set Avatar**, and a **Username** section with its own **Save** ([Accounts](https://vercel.com/docs/accounts)). *(inferred)* Team General works the same way: each setting is its own bordered card with a footer holding a hint and a Save button.
- **Members.** An inline invite form at the top of the page: email, a role dropdown, and **Invite**, with **Add more** for extra rows. If you pick Contributor, an **Assign Project Roles** button adds a per-project role. Members are listed under **Team Members**, and you edit a role with **Manage Role** next to the current role. Removal is **…** › **Remove from Team** ([Managing team members](https://vercel.com/docs/rbac/managing-team-members)). A 2FA status label and an enabled/disabled filter sit on the same page ([2FA enforcement](https://vercel.com/docs/two-factor-enforcement)). The members API supports search by name, username, or email and filtering by role. It returns pending `emailInviteCodes`, each with an `expired` flag, alongside `members` in the same response ([API](https://vercel.com/docs/rest-api/teams/list-team-members)). *(inferred)* The UI exposes the same search and role filter.
- **Invites.** A separate **Pending Invitations** view. Invites expire after 7 days (30 for SAML-enforced teams) and then show as expired ([Managing team members](https://vercel.com/docs/rbac/managing-team-members)). Members › Collaboration settings controls whether Git committers join automatically (**Auto Approval** / **Manual Approval**) ([Accounts](https://vercel.com/docs/accounts)).
- **Danger zone.** **Leave Team** and **Delete Team** are separate sections at the bottom of General, each with its own button and a confirm step. You can't leave as the last owner, and you must remove domains before deleting ([Accounts](https://vercel.com/docs/accounts), [Delete account KB](https://vercel.com/kb/guide/how-do-i-delete-my-vercel-account)). The project equivalent asks you to type the project name *and* a prompt phrase, then **Continue** ([Managing projects](https://vercel.com/docs/projects/managing-projects)). *(inferred)* Team delete uses the same dialog, styled as a red-bordered card.
- **Git.** The project Git settings show a **Connected Git Repository** with toggles. Git login connections belong to the personal account, not the team ([Vercel for GitHub](https://vercel.com/docs/git/vercel-for-github), [Accounts](https://vercel.com/docs/accounts)).

## Slack

- **Identity.** Workspace settings has a **Workspace Name & URL** row with a **Change Workspace Name & URL** button that opens an edit form and Save. The old URL redirects until someone else claims it ([Change name/URL](https://slack.com/help/articles/201663443-Change-your-workspace-or-org-name-and-URL)).
- **Members.** **Tools & settings** › **Manage members** (or Admin › Workspace settings › People). Each row has a three-dot menu with **Change account type**, which offers **Workspace Owner / Workspace Admin / Full Member** and a **Save** button ([Change a member's role](https://slack.com/help/articles/218124397-Change-a-member's-role)).
- **Invites.** People › **Invitations** has a **Pending** tab whose rows offer **Extend Invitation**, **Resend Invitation**, and **Delete Invitation**, plus an **Invite links** tab that shows who created each link and when, with **Deactivate**. Invites and links expire after 30 days ([Pending invitations](https://slack.com/help/articles/360060363633-Manage-pending-invitations-and-invite-links-for-your-workspace)).
- **Danger zone.** A **Delete Workspace** section at the bottom of Workspace settings. Only the Primary Owner can use it. Confirmation takes a checkbox, then your account password, then **Yes, delete my workspace** ([Delete a workspace](https://slack.com/help/articles/204067366-Delete-a-workspace)).
- **Non-admins.** Members can invite people (subject to settings) but don't administer anything ([Permissions by role](https://slack.com/help/articles/201314026-Permissions-by-role-in-Slack)).

## Notion

- **Identity.** Settings › Workspace › General holds **Icon** (click it, then pick an emoji or upload an image), **Name**, and **Allowed email domains**. These are owner-only ([Workspace settings](https://www.notion.com/help/workspace-settings)). *(inferred)* Edits apply in place. The doc mentions no Save button.
- **People.** Tabs for **Members**, **Guests**, and **Suggestions**. Each member row has a role dropdown (**Workspace owner / Membership admin / Member**), and that same dropdown holds **Remove from workspace**. **Add members** opens a flow: email, a role dropdown, then **Invite**. The page also has a **Copy link** invite link and an **Invite link** toggle that turns it off. Temporary members get a **•••** menu with **Edit expiration date** ([Add members](https://www.notion.com/help/add-members-admins-guests-and-groups)).
- **Danger zone.** A section literally titled **Danger zone** at the bottom of General. It holds **Leave workspace** ([Create/leave](https://www.notion.com/help/create-delete-and-switch-workspaces)) and **Delete entire workspace**, which you confirm by typing the workspace name ([Delete a workspace](https://www.notion.com/help/delete-a-workspace)). General also offers **Export all workspace content** and **Export members as CSV** ([Workspace settings](https://www.notion.com/help/workspace-settings)).

## Figma

- **Identity.** Team identity is edited outside settings. From the team-name dropdown in the file browser you choose **Rename** or **Change icon** (500×500 minimum) ([Change team name or icon](https://help.figma.com/hc/en-us/articles/14949911189399-Change-a-team-name-or-icon)).
- **Members.** On Starter and Pro plans, team › **View members** shows a list where you click a person's permission to get a dropdown, which includes **Grant admin access** and **Remove** ([Team permissions](https://help.figma.com/hc/en-us/articles/360039970673-Team-permissions)). On Organization plans, Admin › **People** is a sortable table with name, avatar, email, seat type, billing group, and last active. It supports search by name, a **Filter** for seat, user type (including **Pending**), last active, and more, and bulk actions through checkboxes ([View members and guests](https://help.figma.com/hc/en-us/articles/4420842863255-View-members-and-guests)). Pending invites appear as a *user-type filter* on that table, not a separate tab.
- **Danger zone.** Team-name menu › **Delete...**, then type the team name, then **Delete team**. A deleted team can be restored for 28 days ([Delete a team](https://help.figma.com/hc/en-us/articles/360039482174-Delete-a-team)).

## GitHub (organizations)

- **Identity.** Org Settings › General ("Profile") is a classic form: avatar with **Upload new picture** beneath it, profile fields, and a single **Update profile** button ([Customizing org profile](https://docs.github.com/en/organizations/collaborating-with-groups-in-organizations/customizing-your-organizations-profile)). Renaming is *not* a profile field. It lives in **Danger zone** › **Rename organization**, behind an acknowledgment (**I understand, let's rename my organization**) and then **Change organization's name** ([Renaming](https://docs.github.com/en/organizations/managing-organization-settings/renaming-an-organization)). The slug is the name.
- **People.** The **People** tab has checkboxes for multi-select, and a bulk **X members selected...** menu offers **Change role** and **Remove from organization**, with a confirm dialog listing the people affected ([Ownership continuity](https://docs.github.com/en/organizations/managing-peoples-access-to-your-organization-with-roles/maintaining-ownership-continuity-for-your-organization), [Removing a member](https://docs.github.com/en/organizations/managing-membership-in-your-organization/removing-a-member-from-your-organization)). *(inferred)* There is a "Find a member…" search and a role filter.
- **Invites.** **Invite member** opens a dialog that takes a username or email, then **Invite**, then **Role in the organization** and optional teams, then **Send invitation**. Pending invites have their own **Invitations** page with **Role** and **Source** filters. Each row's kebab menu offers **Edit invitation** and **Cancel invitation**. Invites expire in 7 days, and expired ones move to **Failed invitations** with **Retry invitation** ([Inviting](https://docs.github.com/en/organizations/managing-membership-in-your-organization/inviting-users-to-join-your-organization), [Canceling/editing](https://docs.github.com/en/organizations/managing-membership-in-your-organization/canceling-or-editing-an-invitation-to-join-your-organization)).
- **Danger zone.** A **Danger zone** section at the bottom of General, holding rename, transfer, archive, and **Delete this organization**. Deleting means typing the org name and then **Cancel plan and delete the organization** ([Deleting](https://docs.github.com/en/organizations/managing-organization-settings/deleting-an-organization-account)). *(inferred)* It is drawn as a red-bordered box of rows, each row a title, a description, and a red-text button on the right. Leaving is *not* in org settings. It is in personal Settings › **Organizations** › **Leave** ([Removing yourself](https://docs.github.com/en/account-and-profile/how-tos/organization-membership/removing-yourself-from-an-organization)).
- **GitHub Apps.** Under **Third-party Access** › **GitHub Apps**, each installed app has **Configure**. That opens **Permissions**, **Repository access** (**All repositories / Only select repositories** with **Save**), **Suspend**, and **Uninstall** ([Installed apps](https://docs.github.com/en/apps/using-github-apps/reviewing-and-modifying-installed-github-apps)).

## Raycast

- **Identity.** You set the org avatar, name, and handle at **Create an Organization**. Editing an existing org isn't documented ([Account management](https://manual.raycast.com/account-management)).
- **Members.** The web account page's **Members** section lists full name, email, role, and 2FA status. It has **Copy Invite Link**, **Reset Invite Link**, and **Export Members**, and invitation is link-only (no per-email form). Managers change roles there. Non-manager Members can *see* the full list (name, email, role) but cannot invite, remove, change roles, or see 2FA ([Account management](https://manual.raycast.com/account-management), [Roles](https://manual.raycast.com/teams/roles-and-permissions)).

## Cursor

- **Structure.** The team dashboard has sections for **Overview**, **Settings**, **Members**, **Integrations**, **Cloud Agents**, **Automations**, **Usage**, and **Billing & Invoices** ([Dashboard](https://cursor.com/docs/account/teams/dashboard)).
- **Members.** Each row has a context menu with **Change role** and **Remove**, plus a **Seat** menu for paid tiers. There must always be at least one Admin. A **Show org admins** switch shows org admins as read-only **Org Admin** rows. **Invite Members** offers email entry or a copyable **Invite Link** (long-lived, with advice to revoke it regularly) ([Members](https://cursor.com/docs/account/teams/members), [Teams management](https://cursor.com/help/account-and-billing/teams-management)). Members "cannot leave a team on their own", so an admin must remove them.
- **GitHub.** Integrations shows **Connect** next to GitHub, which becomes **Manage Connections** once connected, then **All repositories / Selected repositories**, then **Disconnect Account**. An installation belongs to the one team that connected it ([GitHub](https://cursor.com/docs/integrations/github)). How the connected account name appears isn't documented.

---

## Synthesis: recurring patterns

1. **Identity sits first and is small.** Avatar on the left, name and slug beside it. Upload means clicking the avatar itself (Linear, Notion, Vercel). *(inferred)* Remove/replace sits in the same spot. Nobody gives the logo a section of its own.
2. **Per-field saves, not one big form.** *(inferred)* Linear and Notion save in place (neither doc mentions a Save button), and Vercel gives each field its own section and Save (documented for account Avatar and Username). GitHub's single **Update profile** form is the older pattern, and even GitHub moves the risky field (rename) out of it.
3. **Renaming the slug counts as consequential.** GitHub puts it in the Danger zone. Slack warns that the old URL redirects until someone claims it. The display name and the URL-bearing handle are treated differently.
4. **Members is a table with search and filters.** Linear (2024), Figma, and Vercel all moved to sortable, filterable tables that include activity data (last active). Role and status are filters.
5. **Pending invites live on the same table or one tab away, never hidden.** Linear and Figma show them as a status/type filter. Vercel, Slack, and GitHub give them a sibling tab. Every product exposes resend/extend and revoke, and Vercel, Slack, and GitHub show expiry (7 or 30 days).
6. **Inline invite where the action is frequent, a dialog where options branch.** Vercel puts email + role + **Invite** inline with **Add more**. GitHub and Linear use a dialog because team or role options follow.
7. **Invite link is a separate, revocable object.** Copy, reset/rotate, and an on/off toggle (Notion, Raycast, Linear, Slack, Cursor), often with a warning that anyone holding the link can join.
8. **Role changes happen on the row.** Either an inline dropdown on the role cell (Notion, Figma, Vercel's **Manage Role**) or a row **⋯** › **Change role** (Linear, Slack, Cursor). Bulk changes use checkboxes plus a selection menu (GitHub, Figma).
9. **The Danger zone is literally named and sits last.** Notion and GitHub title it **Danger zone**. Leave and Delete are separate rows, each with its own button.
10. **Confirmation scales with blast radius.** Leave: one confirm. Delete: type the name (Notion, GitHub, Figma, Vercel projects), or a password (Slack), or an emailed code plus a 48h cancel window (Linear), or a 28-day restore (Figma).
11. **Invariants guard the destructive paths.** You can't leave as the last owner (Vercel), there must be at least one Admin (Cursor), and you must remove domains or cancel billing first (Vercel, Figma). Vercel's KB notes the delete button may stay disabled until prerequisites are met.
12. **Integrations name the connection and offer one control per scope.** **Connect** becomes **Manage**, then repository scope, then **Disconnect** (Cursor, GitHub Apps). The org-level connection is kept apart from each member's personal account link (Linear's two banners, Vercel login connections).

## Anti-patterns

1. **Identity edits hidden in context menus** (Figma's team-name dropdown for Rename and Change icon). Nothing on the settings page tells you where to look.
2. **Leave lives somewhere other than the workspace** (GitHub puts it in personal Settings › Organizations), or doesn't exist (Cursor members can't leave). Users look for Leave next to Delete.
3. **The invite link sits on a different page from the invite form** (Linear puts it under Security). The two ways of adding people are split.
4. **Fragmented member surfaces.** Slack has two routes with different role labels ("Full Member" vs "Regular Member"), and Figma's team list and org table differ by plan. One table with filters beats several lists.
5. **Danger actions without preconditions surfaced.** A Delete button that only fails afterwards (domains still attached, billing still active) instead of showing up disabled with the reason.

---

## Sources

- https://linear.app/docs/workspaces
- https://linear.app/docs/members-roles
- https://linear.app/docs/invite-members
- https://linear.app/docs/profile
- https://linear.app/docs/github
- https://linear.app/changelog/2024-12-18-personalized-sidebar
- https://vercel.com/docs/accounts
- https://vercel.com/docs/rbac/managing-team-members
- https://vercel.com/docs/two-factor-enforcement
- https://vercel.com/docs/rest-api/teams/list-team-members
- https://vercel.com/docs/cli/teams
- https://vercel.com/docs/projects/managing-projects
- https://vercel.com/docs/git/vercel-for-github
- https://vercel.com/kb/guide/how-do-i-delete-my-vercel-account
- https://slack.com/help/articles/201663443-Change-your-workspace-or-org-name-and-URL
- https://slack.com/help/articles/218124397-Change-a-member's-role
- https://slack.com/help/articles/360060363633-Manage-pending-invitations-and-invite-links-for-your-workspace
- https://slack.com/help/articles/204067366-Delete-a-workspace
- https://slack.com/help/articles/201314026-Permissions-by-role-in-Slack
- https://www.notion.com/help/workspace-settings
- https://www.notion.com/help/add-members-admins-guests-and-groups
- https://www.notion.com/help/create-delete-and-switch-workspaces
- https://www.notion.com/help/delete-a-workspace
- https://help.figma.com/hc/en-us/articles/14949911189399-Change-a-team-name-or-icon
- https://help.figma.com/hc/en-us/articles/360039482174-Delete-a-team
- https://help.figma.com/hc/en-us/articles/360039970673-Team-permissions
- https://help.figma.com/hc/en-us/articles/4420842863255-View-members-and-guests
- https://docs.github.com/en/organizations/collaborating-with-groups-in-organizations/customizing-your-organizations-profile
- https://docs.github.com/en/organizations/managing-organization-settings/renaming-an-organization
- https://docs.github.com/en/organizations/managing-organization-settings/deleting-an-organization-account
- https://docs.github.com/en/organizations/managing-membership-in-your-organization/inviting-users-to-join-your-organization
- https://docs.github.com/en/organizations/managing-membership-in-your-organization/canceling-or-editing-an-invitation-to-join-your-organization
- https://docs.github.com/en/organizations/managing-membership-in-your-organization/removing-a-member-from-your-organization
- https://docs.github.com/en/organizations/managing-peoples-access-to-your-organization-with-roles/maintaining-ownership-continuity-for-your-organization
- https://docs.github.com/en/account-and-profile/how-tos/organization-membership/removing-yourself-from-an-organization
- https://docs.github.com/en/apps/using-github-apps/reviewing-and-modifying-installed-github-apps
- https://manual.raycast.com/account-management
- https://manual.raycast.com/teams/roles-and-permissions
- https://cursor.com/docs/account/teams/members
- https://cursor.com/docs/account/teams/dashboard
- https://cursor.com/help/account-and-billing/teams-management
- https://cursor.com/docs/integrations/github
