# How five products make the current workspace obvious: Slack, Linear, Notion, Vercel, GitHub

Researched 2026-10-14 from vendor docs, help centers, and changelogs. Every claim cites a URL. "Docs silent" means the official page I read does not cover it. "(unsourced, from product familiarity)" marks something I know from using the product but could not find in a doc.

---

## Slack

**1. Switcher.** "Click the workspace icon in the top left" to see "a list of all the workspaces you're signed in to" ([Switch between workspaces](https://slack.com/help/articles/1500002200741-Switch-between-workspaces)). The switcher can also stay open as a column of workspace icons in the sidebar, which you can drag to reorder ([same](https://slack.com/help/articles/1500002200741-Switch-between-workspaces)). To add an account: workspace icon, then **Add a workspace**, then **Sign in to another workspace** ([Sign in to Slack](https://slack.com/help/articles/212681477-Sign-in-to-Slack)). Keyboard shortcuts ([Slack keyboard shortcuts](https://slack.com/help/articles/201374536)):
- ⌘⇧S opens or closes the switcher.
- Ctrl+Tab and Ctrl+⇧+Tab move to the next and previous workspace.
- ⌘1–9 jumps to a workspace. Each workspace's number is shown under its icon.

Org-level settings are under **Tools & settings → Organization settings** ([SSO article](https://slack.com/help/articles/220403548)).

**2. Always-visible identity.** The current workspace's icon sits in the top left ([same](https://slack.com/help/articles/1500002200741-Switch-between-workspaces)). Clicking the workspace name in the sidebar opens a menu with **Tools & settings → Workspace settings** ([Change workspace name/URL](https://slack.com/intl/en-gb/help/articles/201663443-Change-your-workspace-or-org-name-and-URL)). Newer copy of that article routes the same task through **Admin → Edit workspace** instead.

**3. Window title.** Docs silent. The desktop title carries the channel and workspace names (unsourced, from product familiarity).

**4. Accent colour.** Slack recommends themes as a way to tell workspaces apart: "If you use multiple workspaces, try selecting a different theme for each one to help tell them apart" ([Change your Slack theme](https://slack.com/help/articles/205166337-Change-your-Slack-theme)). The path is profile picture → **Preferences → Themes** ([same](https://slack.com/help/articles/205166337-Change-your-Slack-theme)). An org can restrict this: Stanford's grid allows only one theme across all its workspaces ([Stanford UIT](https://uit.stanford.edu/service/slack/redesign2023/sidebar)).

**5. Cross-workspace links.** Docs silent on whether the app switches workspace automatically. A profile deeplink "will only open Slack for members with access to your workspace" ([Create a link to a member's profile](https://slack.com/help/articles/360003827751-Create-a-link-to-a-members-profile)). If you're signed in, the desktop app switches to the link's workspace; if not, the browser asks you to sign in (unsourced, from product familiarity).

**6. Moving items.** Enterprise admins can move a channel to another workspace ([Move channels](https://slack.com/help/articles/115001946688-Move-channels-between-workspaces-in-an-Enterprise-organization)).
- **Steps:** open the **Move Channels** page (my.slack.com/admin/channels), tick channels, click **Show selected → Move to…**, pick a workspace, click **Confirm Move**, then confirm once more. A CSV bulk path (**Select from CSV**) also exists.
- **What moves:** messages (with threads and reactions), files, pins, retention policies, topic, and description.
- **What's lost:** members who aren't on the destination workspace lose access. Apps and bots must be reinstalled. Workflows must be unpublished and re-imported. Channel analytics reset.
- **What can't move:** #general, archived channels, multi-workspace channels, Slack Connect channels, and empty private channels.
- **Afterwards:** members are told which workspace the channel moved to.

**7. Personal vs team.** No personal workspace. Enterprise users can filter Home by **All workspaces** or by a single workspace ([Switch between workspaces](https://slack.com/help/articles/1500002200741-Switch-between-workspaces); [Stanford](https://uit.stanford.edu/service/slack/redesign2023/sidebar)).

**8. Notifications from other workspaces.** "You'll see a numbered badge on your workspace icon when there's unread activity in your other workspaces." Opening the switcher shows a badge on each workspace that has unread activity ([Guide to Slack notifications](https://slack.com/help/articles/360025446073-Guide-to-Slack-notifications)). The dock icon shows a dot for unread activity in any workspace, and a number for DMs and mentions ([same](https://slack.com/help/articles/360025446073-Guide-to-Slack-notifications)).

**9. Settings split.** Personal settings are **Preferences**, opened from your profile picture ([theme article](https://slack.com/help/articles/205166337-Change-your-Slack-theme)). Workspace settings are opened from the workspace name: **Tools & settings → Workspace settings**, and for an org, **Organization settings** ([1](https://slack.com/intl/en-gb/help/articles/201663443-Change-your-workspace-or-org-name-and-URL), [2](https://slack.com/help/articles/220403548)). So the personal and workspace entry points sit at different spots in the sidebar.

**10. Breadcrumbs.** None. Docs silent.

**11. Create flow.** Docs silent. New channels go into the current workspace (unsourced, from product familiarity).

**12. Integration scope.** Apps are installed per workspace, which is why a moved channel needs its apps reinstalled ([Move channels](https://slack.com/help/articles/115001946688-Move-channels-between-workspaces-in-an-Enterprise-organization)).

---

## Linear

**1. Switcher.** "Click the workspace name in the top-left corner, then hover over **Switch workspace**." The shortcut is `O` then `W`. The same menu has **Create or join a workspace** and **Settings** ([Workspaces](https://linear.app/docs/workspaces)).

**2. Always-visible identity.** The workspace name and logo sit in the top left of the sidebar. Admins can "customize the workspace's logo, name, and domain key" ([Workspaces](https://linear.app/docs/workspaces)). Teams have icons tinted with the team colour: "the color of team icons is applied to the background of the icon" ([2022 changelog](https://linear.app/changelog/2022-01-20-linear-preview-new-sidebar-and-team-icons)). Teams you've joined appear in the sidebar. Teams you're only browsing appear under a temporary **Exploring** section ([Teams](https://linear.app/docs/teams)).

**3. Window title.** Docs silent.

**4. Accent colour.** No per-workspace theme is documented. Per-team colour is documented (see 2).

**5. Cross-workspace links.** Docs silent. Linear URLs include the workspace key (`linear.app/<workspace>/issue/…`), and opening one for another signed-in workspace switches to it (unsourced, from product familiarity).

**6. Moving items.** ⌘⇧M moves an issue to another team "within the same workspace" ([Create issues](https://linear.app/docs/creating-issues)). Per the move guide ([Move to new team](https://linear.app/docs/move-to-new-team), [Edit issues](https://linear.app/docs/editing-issues.md)):
- The issue gets a new ID and URL. Old URLs redirect. Searching an old ID finds the issue. Inline references like `#ENG-123` redirect when clicked but still display the old ID.
- **Cycles:** removed.
- **Team labels:** removed, unless a label with the same name exists in the new team.
- **Projects:** removed, unless the new team is added to the project first.
- **Status:** matched by name, otherwise the first status in the same category.
- **Undo:** ⌘Z undoes the move but not the data that was removed.

**7. Personal vs team.** Confirmed: there is no personal workspace. Linear suggests separate accounts with different emails for work and personal use. Each workspace keeps its own members and billing, "even if you connect to them from the same account" ([Workspaces](https://linear.app/docs/workspaces)).

**8. Notifications from other workspaces.** Docs silent. The Inbox covers "important updates on issues in your workspace", one workspace at a time ([Inbox](https://linear.app/docs/inbox)).

**9. Settings split.** Settings has four groups ([Dec 2024 changelog](https://linear.app/changelog/2024-12-18-personalized-sidebar)):
- **Account:** personal settings, notifications, preferences.
- **Features:** workspace features.
- **Administration:** admins only.
- **Your teams:** settings for each team you belong to.

Notification settings live under **Settings > Account > Notifications** ([Notifications](https://linear.app/docs/notifications.md)).

**10. Breadcrumbs.** Docs silent. The issue header shows Team › Issue ID (unsourced, from product familiarity).

**11. Create flow.** `C` opens the composer. "Issues must belong to a single team," and the URL parameter `team` accepts a UUID or the team key ([Create issues](https://linear.app/docs/creating-issues)). Docs don't describe the composer's team chip, which defaults to the current team and can be changed (unsourced, from product familiarity).

**12. Integration scope.** GitHub is set up per workspace under **Settings > Features > Integrations > GitHub**: pick the GitHub org, then **All repositories** or **Only select repositories**. PR automations are set per team: "it must be configured for each team in your workspace." Each person links their own GitHub account under **Settings > Connected accounts** ([GitHub](https://linear.app/docs/github)).

---

## Notion

**1. Switcher.** Click the workspace name to open the switcher ([Create, join & leave workspaces](https://www.notion.com/help/create-delete-and-switch-workspaces)). It lists:
- the workspaces for each email you've signed in with,
- **Add another account** and **Join or create workspace**,
- a **•••** menu per account with **Log out**, plus **Log out all**,
- Settings.

The shortcut is Ctrl+⇧+number, where the number is the workspace's position in the list. The docs disagree on placement. The main text says the name "sits at the bottom" of the sidebar, and the FAQs say "very top" / "top left" ([Navigate with the sidebar](https://www.notion.com/help/navigate-with-the-sidebar), [Intro to workspaces](https://www.notion.com/help/intro-to-workspaces), [New sidebar](https://www.notion.com/help/sidebar)). The "bottom" wording appears to come from the opt-in new sidebar, which you turn on in the switcher ("Try the New Sidebar") ([New sidebar](https://www.notion.com/help/sidebar)). The classic layout puts the name at the top left (unsourced, from product familiarity).

**2. Always-visible identity.** Each workspace has a name and an icon (emoji or uploaded image), set under **Settings → Workspace → General** ([Workspace settings](https://www.notion.com/help/workspace-settings)). Docs don't say how the switcher looks when the sidebar is collapsed.

**3. Window title.** Docs silent. The title shows the page title only (unsourced, from product familiarity).

**4. Accent colour.** None is documented per workspace. Teamspaces have their own icons ([Intro to teamspaces](https://www.notion.com/help/intro-to-teamspaces)).

**5. Cross-workspace links.** When you open a page you can't access, you can select **No access** to send a request. A member with view access can use **Share → Request edit access**. The page creator approves or ignores ([Sharing & permissions](https://www.notion.com/en-gb/help/sharing-and-permissions)). Docs don't say whether opening a link switches workspace. It does when you're signed in to that workspace (unsourced, from product familiarity).

**6. Moving items.** Within a workspace, **••• → Move to** lists teamspaces as destinations ([Intro to teamspaces](https://www.notion.com/help/intro-to-teamspaces)). Moving to another workspace is really a copy ([Duplicate content to another workspace](https://www.notion.com/help/transfer-content-to-another-account)):
- **Steps:** **••• → Move to**, open the dropdown next to the current workspace name, pick the destination workspace and a location, then confirm with **"I understand, duplicate"**.
- **What's kept:** the originals stay where they were.
- **What can break:** links, relations, permissions, page history.
- **Admin control:** admins can turn on **Disable moving pages to other workspaces** under **Security & identity**.

For top-level pages under the same account, the sidebar's **Move to** also offers a workspace dropdown, and sub-pages move with their parent ([Create, join & leave](https://www.notion.com/help/create-delete-and-switch-workspaces)).

**7. Personal vs team.** The sidebar has three kinds of section ([Navigate with the sidebar](https://www.notion.com/help/navigate-with-the-sidebar)):
- **Private:** anything you add there "is only visible to you".
- **Shared:** pages you've shared with specific people.
- **Teamspaces:** on paid plans.

Teamspaces can be Open, Closed, or Private ([Teamspaces guide](https://www.notion.com/help/guides/teamspaces-give-teams-home-for-important-work)).

**8. Notifications from other workspaces.** Docs silent. The Inbox (top right of the sidebar) collects "mentions of you across your workspace" ([Intro to workspaces](https://www.notion.com/help/intro-to-workspaces), [New sidebar](https://www.notion.com/help/sidebar)).

**9. Settings split.** One Settings window holds both:
- **Account (`{your name}`):** profile, email, password, 2FA, passkeys, delete account ([Account settings](https://www.notion.com/help/account-settings)).
- **Preferences:** appearance, language, time zone ([Account settings](https://www.notion.com/help/account-settings)).
- **Workspace:** General, Security, Identity, Emoji, for owners only ([Workspace settings](https://www.notion.com/help/workspace-settings)).

Search results label where each setting lives, for example "Workspace / General" ([Workspace settings](https://www.notion.com/help/workspace-settings)).

**10. Breadcrumbs.** "At the top of your page, you'll see breadcrumbs that show you what page you're in, and where that page lives" ([Create a subpage](https://www.notion.com/help/create-a-subpage)). The trail starts with the teamspace or Private (unsourced, from product familiarity).

**11. Create flow.** The new-page button opens a page "in preview mode", with a dropdown to choose a location, including "one of your other workspaces." "If you don't choose, it will default to your Private section" ([Navigate with the sidebar](https://www.notion.com/help/navigate-with-the-sidebar), [New sidebar](https://www.notion.com/help/sidebar)). Hovering a teamspace in the sidebar shows **+** to create a page inside it ([Intro to teamspaces](https://www.notion.com/help/intro-to-teamspaces)).

**12. Integration scope.** Docs I read are silent on the integration pickers.

---

## Vercel

**1. Switcher.** "Select the team switcher at the top left of the navigation bar," then pick a team from the list. Creating a team starts in the same switcher ([Account Management](https://vercel.com/docs/accounts)). The switcher also lists suggested teams you can request to join ([changelog](https://vercel.com/changelog/request-access-to-teams-right-from-the-dashboard)). You can jump to another team's project without switching teams first, favourite projects, and use the keyboard; the current view is kept when you change project ([changelog](https://vercel.com/changelog/improved-experience-for-moving-between-your-teams-and-projects)). On the CLI, `vercel switch` changes team and `--scope` overrides it for one command ([CLI teams](https://vercel.com/docs/cli/teams.md), [global options](https://vercel.com/docs/cli/global-options)).

**2. Always-visible identity.** "The avatar is in the top-left corner of every dashboard page," next to the team-name dropdown ([Academy: Tour the Dashboard](https://vercel.com/academy/optimize-your-vercel-account/tour-the-dashboard)). The 2026 redesign moved the tabs into a sidebar you can resize or hide, with the same links at team and project level ([changelog](https://vercel.com/changelog/new-dashboard-navigation-available)). The redesign became the default from 2026-02-25 ([rollout](https://vercel.com/changelog/dashboard-navigation-redesign-rollout)). A **Default Team** setting picks which team `/dashboard` opens ([Account Management](https://vercel.com/docs/accounts)).

**3. Window title.** Docs silent.

**4. Accent colour.** None is documented. Only the team avatar tells teams apart.

**5. Cross-team links.** Docs links use a team-neutral form, `vercel.com/d?to=/[team]/~/settings/...` ([Notifications](https://vercel.com/docs/notifications)). Docs don't say how `[team]` gets filled in. The dashboard asks you to pick a team (unsourced, from product familiarity). A user who isn't a member can request access, and an owner approves it ([changelog](https://vercel.com/changelog/request-access-to-teams-right-from-the-dashboard), [REST](https://vercel.com/docs/rest-api/teams/request-access-to-a-team)).

**6. Moving items.** **Settings → General → Transfer Project → Transfer** ([Transferring a project](https://vercel.com/docs/projects/transferring-projects)).
- **Flow:** pick the target team (or create one). A review screen lists the domains, aliases, and environment variables that will move, and lets you rename the project. Click **Transfer**.
- **During the transfer:** "The original project **will be hidden**," with zero downtime. Vercel redirects you to the new project, which shows progress indicators. Nothing can be deployed or edited until it finishes. When it's done, the person who started it and the target team's owners get an email.
- **What moves:** deployments, environment variables (copied), domains, builds, the Git link, crons, Web Analytics, Speed Insights.
- **What doesn't:** integrations (add them again), usage (reset), logs, monitoring, log drains, Blob, Sandboxes, Secure Compute, and env vars set in `vercel.json`.

**7. Personal vs team.** In January 2024 personal accounts became free teams, each with the slug `{username}s-projects`. The username stays in account settings ([changelog](https://vercel.com/changelog/2024-01-account-changes)). So the personal space is now a "Hobby team" in the same switcher, set apart by its plan rather than by a different kind of object ([Account Management](https://vercel.com/docs/accounts)).

**8. Notifications from other teams.** A bell with an unread count opens a popover ([Notifications](https://vercel.com/docs/notifications)). Preferences are per team: "Select your team from the team switcher," then **Settings → Account → My Notifications**. Changes "will only be reflected for your notifications" ([same](https://vercel.com/docs/notifications)). Docs don't say whether the bell filters by team.

**9. Settings split.** Account settings open from your avatar at the top right: **Settings**, then Authentication, Emails, Default Team ([Account Management](https://vercel.com/docs/accounts)). Team settings open from the team's sidebar. Inside team settings, an **Account** group holds your per-team items such as My Notifications ([Notifications](https://vercel.com/docs/notifications)). Project settings are a third level ([Academy](https://vercel.com/academy/optimize-your-vercel-account/tour-the-dashboard)).

**10. Breadcrumbs.** Docs silent. The header reads `team / project` with slash separators, each part a dropdown (unsourced, from product familiarity).

**11. Create flow.** The docs tell you to "ensure you have selected the correct team from the team switcher," then click **Add New… → Project** ([Managing projects](https://vercel.com/docs/projects/managing-projects)). "New projects will default to your currently selected Personal Account or Team" ([changelog](https://vercel.com/changelog/get-started-faster-with-the-new-project-creation-flow)).

**12. Integration scope.** The import screen has **Configure GitHub App** for granting repo access, and **Only select repositories** limits what's visible ([KB](https://vercel.com/kb/guide/unable-to-find-github-repository)). I could not find the label for the Git account selector in the docs. It is a dropdown of GitHub accounts and orgs above the repo list (unsourced, from product familiarity). Integrations are installed per team and don't move with a project ([Transferring](https://vercel.com/docs/projects/transferring-projects)).

---

## GitHub

**1. Switcher.** There are two switchers:
- **Dashboard context:** click your username at the top left of the dashboard. The **Switch dashboard context** menu lists "organizations linked to the personal account" ([Org dashboard](https://docs.github.com/en/organizations/collaborating-with-groups-in-organizations/about-your-organization-dashboard)).
- **Account:** profile menu (top right) → **Switch account** → **Add account**, or **See all accounts** when sessions have expired. Sessions stay on that browser ([Switching between accounts](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/switching-between-accounts)).

The GitHub logo opens a global menu with your top repos and teams ([2023 changelog](https://github.blog/changelog/2023-04-05-redesigned-navigation-available-in-public-beta/)).

**2. Always-visible identity.** The owner's avatar and name lead the breadcrumb. Avatar shape carries meaning: "Circle Avatars represent individual people," and "Square Avatars represent non-human entities, such as bots, AI agents, teams, or organizations" ([Primer Avatar](https://primer.style/product/components/avatar/)).

**3. Window title.** Docs silent. The title includes `owner/repo` (unsourced, from product familiarity).

**4. Accent colour.** None.

**5. Cross-org links.** For an org that requires SAML, GitHub redirects you to the identity provider and then back. A recent sign-in at the provider authorizes you automatically, for 24 hours by default ([About SSO](https://docs.github.com/en/enterprise-cloud@latest/authentication/authenticating-with-single-sign-on/about-authentication-with-single-sign-on)). Docs don't describe what you see when you lack access. A private repo returns 404 (unsourced, from product familiarity).

**6. Moving items.** **Settings → Danger Zone → Transfer** ([Transferring a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository)).
- **Flow:** under **New owner**, choose **Select one of my organizations** or **Specify an organization or username**. Review warnings about features you may lose. Type the repo name in "Type REPOSITORY NAME to confirm," then click **I understand, transfer this repository**.
- **What's kept:** issues, PRs, wiki, stars, watchers, webhooks, secrets, and deploy keys. Old links redirect until someone creates a repo at the old name.
- **What changes:** issue assignees are filtered by org membership. The Pages site doesn't redirect.

**7. Personal vs org.** "You cannot sign in to an organization." You always act as your own account ([Types of accounts](https://docs.github.com/en/get-started/learning-about-github/types-of-github-accounts)). Personal accounts get circle avatars and orgs get square ones ([Primer](https://primer.style/product/components/avatar/)).

**8. Notifications from other orgs.** There is one inbox across all orgs. Use the filter `org:octo-org`: "useful if you belong to several organizations." `repo:owner/repo` filters by repo ([Inbox filters](https://docs.github.com/en/subscriptions-and-notifications/reference/inbox-filters)). You can save up to 15 custom filters ([Managing from inbox](https://docs.github.com/en/subscriptions-and-notifications/how-tos/viewing-and-triaging-notifications/managing-notifications-from-your-inbox)). **Custom routing → Add new route** sends a given org's email to a verified address ([Org notifications](https://docs.github.com/subscriptions-and-notifications/how-tos/managing-organization-notifications)).

**9. Settings split.** Personal settings open from the profile menu. Org settings: profile picture → **Organizations** → pick the org → **Settings** tab under the org name ([Accessing org settings](https://docs.github.com/en/organizations/collaborating-with-groups-in-organizations/accessing-your-organizations-settings)). They are separate pages with separate URLs.

**10. Breadcrumbs.** The 2023 redesign added breadcrumbs that "provide a clear understanding of your location" ([changelog](https://github.blog/changelog/2023-04-05-redesigned-navigation-available-in-public-beta/)). Since June 2026, a chevron next to the repo name in the breadcrumb opens a repository switcher. It searches "your organization or owner namespace," so the switcher stays inside the current owner ([changelog](https://github.blog/changelog/2026-06-18-repository-switcher-generally-available-in-global-navigation/)).

**11. Create flow.** **+ → New repository**, then the **Owner** dropdown ("octocat", "github", and so on) next to **Repository name** ([Creating a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository)). The URL parameters are `?owner=` and `?name=`, and `owner=@me` means your own account ([same](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository)).

**12. Integration scope.** Installing an app: "select your personal account or an organization," then **All repositories** or **Only select repositories**. The button reads **Install**, **Install and request**, or **Request**, depending on whether an org owner must approve ([Installing a GitHub App](https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party)).

---

## Cross-product patterns

1. **The switcher is the scope's name, at the top left.** Slack, Linear, Vercel, and the GitHub dashboard all put the current scope's name or icon at the top left and make it the switcher. Notion does too in the classic sidebar; its docs now also place it at the bottom (new sidebar). The menu follows one shape: the list of scopes, then create/join, settings, then sign out or add account (Slack, Linear, Notion, Vercel). Only Slack and Notion document number-key shortcuts (⌘1–9, Ctrl+⇧+number). Linear uses `O W` and Slack uses ⌘⇧S to open the switcher.

2. **Identity comes from the avatar, not colour.** Every product shows a workspace icon or avatar. Colour as an identity cue is rare: only Slack recommends a different theme per workspace, and Linear colours teams, not workspaces. GitHub encodes the kind of owner in avatar shape: circle for a person, square for an org.

3. **The scope leads the breadcrumb.** GitHub (`owner / repo`), Vercel (`team / project`), Linear (Team › Issue), and Notion (teamspace or Private first) all start the path with the scope. GitHub and Vercel make each part a dropdown, and GitHub's repo switcher searches only within the current owner.

4. **Settings are split by heading, in one place.** Linear shows **Account / Features / Administration / Your teams** in one sidebar. Notion shows **{your name} / Preferences / Workspace** in one window, with search results labelled "Workspace / General". Vercel nests an **Account → My Notifications** group inside team settings, for personal settings that apply to one team. Slack and GitHub use different entry points instead: profile menu for you, workspace name or org page for the workspace.

5. **Creating something names where it goes.** GitHub has an explicit **Owner** dropdown. Notion has a location dropdown that falls back to Private. Linear requires a team. Vercel uses the team you have selected ("ensure you have selected the correct team"), which is the weakest of the four. The safest pattern names the destination and lets you change it in the create flow itself.

6. **Moving is a reviewed, often typed confirmation, and the copy lists what's lost.** GitHub (type the name, "I understand, transfer this repository") and Notion ("I understand, duplicate") put "I understand" on the button. Vercel shows a list of what will move, and Slack asks you to confirm twice. Every product documents a kept/lost list. Integrations or apps are lost in Slack, Vercel, and Linear (as labels, cycles, and projects). Old URLs redirect in Linear and GitHub. Notion does not truly move across workspaces; it copies.

7. **Personal spaces are being folded into the team model.** Vercel turned personal accounts into Hobby teams (`{username}s-projects`). Linear has no personal workspace and recommends a separate account. Notion's personal space is a **Private** section inside each workspace. GitHub keeps a real personal account, set apart by avatar shape. Slack has no personal space.

8. **Notifications from other workspaces.** Two models:
   - **Badge per workspace:** Slack shows a numbered badge on the workspace icon, plus per-workspace badges in the switcher.
   - **One inbox with a scope filter:** GitHub's `org:` filter and per-org email routing.

   Linear, Notion, and Vercel scope their inboxes to the current workspace or team. Their docs say nothing about notifications from other workspaces.

9. **Cross-scope links are mostly undocumented.** The documented behaviours are a request-access path (Notion **No access**/**Request edit access**, Vercel team access requests), an SSO redirect (GitHub SAML), and team-neutral deep links (Vercel `vercel.com/d?to=/[team]/…`). Switching workspace automatically on a link is common practice but undocumented for Slack, Linear, and Notion.

10. **Integrations are scoped to the workspace, then narrowed to repos.** GitHub app installs, Vercel imports, and Linear's GitHub integration all follow the same steps: choose the account or org, then **All repositories** or **Only select repositories**, then link at the team or project level (Linear's per-team automations, Vercel's per-project Git link).
