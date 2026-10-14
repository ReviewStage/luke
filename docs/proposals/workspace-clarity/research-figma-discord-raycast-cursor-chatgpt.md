# How five products make the current workspace obvious (research B)

Researched 2026-10-14 against current vendor docs. Every claim cites a URL. Claims marked **(unsourced, from product familiarity)** come from using the product, not from a doc; treat them as leads to verify by screenshot. "Docs silent" means I looked and found nothing.

---

## 1. Figma

**Switcher.** In the file browser, the team or organization name has a dropdown icon whenever you belong to more than one team or org. On Organization/Enterprise plans the dropdown sits next to the organization name ([Guide to the file browser](https://help.figma.com/hc/en-us/articles/14381406380183)). Accounts are a separate layer: "click your name at the top-left of the screen" in the file browser, pick an account or **Add account**, and "Figma will open the file browser in that account" ([Switch between accounts](https://help.figma.com/hc/en-us/articles/1500005165741-Switch-between-accounts)). You can only switch accounts from the file browser; community threads say you can't switch inside an open file ([forum](https://forum.figma.com/t/be-able-to-switch-accounts/23911/)). The docs give no keyboard shortcut. Enterprise adds **workspaces** (groups of teams). On login a member may get a **Select workspace** window with the options "My workspace isn't listed" and "I don't know my workspace" ([Select organization workspace](https://help.figma.com/hc/en-us/articles/4409603173143-Select-organization-workspace)).

**Always-visible identity.** The sidebar's top-level entries name the context: **Team / Drafts / Browse / Trash / Admin / Starred** on Starter/Pro, and **Organization / Drafts / Browse / Trash / Admin / Custom sidebar** on Org/Enterprise ([file browser guide](https://help.figma.com/hc/en-us/articles/14381406380183)). Inside a file, the left panel header shows the file name with its folder (or "Drafts") and a plan badge beneath **(unsourced, from product familiarity)**.

**Title.** Docs silent. The browser tab shows "File name – Figma" with no team in it **(unsourced, from product familiarity)**. File URLs carry only a file key and name (`/design/<key>/<name>`), with no team or org ([Guide to files and folders](https://help.figma.com/hc/en-us/articles/1500005554982-Guide-to-files-and-folders)).

**Accent colour.** Teams have no theme colour. As of August 2026, **folders** (formerly "projects") can be colour-coded and nested ([forum: projects become folders](https://forum.figma.com/product-updates-3/rolling-out-projects-become-folders-56675/index4.html); [createwith summary](https://www.createwith.com/tool/figma/updates/figma-renames-projects-to-folders-with-full-nesting-support)).

**Cross-team links.** Because a URL holds no team, a file opens if your *account* has access, whichever team you were browsing (inferred from the URL format above). With view-only access you get **Ask to edit** in the toolbar. The owner is notified, and pending requests put "a red badge … on the share button" ([Request to edit a file](https://help.figma.com/hc/en-us/articles/4408435431319-Request-to-edit-a-file)). The wrong *account*, though, is a known pain: Figma opens shared links with whichever account the browser session holds, and doesn't ask ([forum request](https://forum.figma.com/suggest-a-feature-11/account-selection-when-opening-shared-links-and-privacy-issues-41010)). If someone outside an Enterprise org opens a shared link, the org's guest setting applies. Under "External users can only join the organization with admin approval" the inviter "is informed that admin approval is required" ([Restrict or prevent guest access](https://help.figma.com/hc/en-us/articles/4410793238167-Restrict-or-prevent-guest-access); [Accept guest access requests](https://help.figma.com/hc/en-us/articles/4420542281495-Accept-guest-access-requests)).

**Moving.** Right-click a thumbnail, then **Move file…**, choose a folder, then **Move**. Several files: **Move [X] Files**. From a canvas: the icon next to the file name, then **Move…** ([Move a file](https://help.figma.com/hc/en-us/articles/360038511573)). The rules are about access:
- Drafts to a folder: needs edit access on the destination and a seat that covers the file type.
- Folder to folder in another team: needs membership and edit access in both teams. Access then extends to "everyone in the new team."
- Between accounts or orgs: "Not possible." The workarounds are transferring a whole folder (paid on both sides) or saving a copy and importing it. An imported file stops receiving team-library updates.
- The doc's only warning: moving may change who can access the file. It names no confirmation dialog.

**Personal vs team.** Since 9 October 2025 drafts no longer stand apart. "All drafts will live within a specific team," and each team has its own **Drafts** section, which stays "private to you and anyone you choose to share them with." Figma's stated reason: drafts outside any team "made ownership unclear" ([Updates to how drafts work](https://help.figma.com/hc/en-us/articles/18409526530967-Updates-to-how-drafts-work)).

**Notifications.** A bell next to the account menu shows a red dot. The modal holds the 50 most recent items and offers **Mark all as read**. "If you've added multiple Figma accounts, Figma only displays notifications from the account you're currently on" ([Manage your notification preferences](https://help.figma.com/hc/en-us/articles/360039813234-Manage-your-notification-preferences)). Teams *within* one account share a single feed; the docs show no per-team badges.

**Settings.** Account menu, then **Settings**, with tabs **Account / Community / Notifications**. Members of an org also see "the organization name and your seat and account types within that organization" here ([View and manage account settings](https://help.figma.com/hc/en-us/articles/1500006061462-View-and-manage-account-settings)). Team and org management live under the **Admin** sidebar entry, split into org admin, workspace admin, and team admin ([Guide to teams](https://help.figma.com/hc/en-us/articles/360039480614-Guide-to-teams)).

**Breadcrumbs.** Docs silent on the current header format. The older UI showed "Folder / File name" at the top centre; UI3 moves it to the left panel header **(unsourced, from product familiarity)**.

**Create flow.** Destination is implicit. "Anyone with a Figma account can create files in their drafts. Only people with can edit access to a team can create files in that team." The URL shortcuts (`figma.new`, `figjam.new`) create the file in drafts ([Create a new file](https://help.figma.com/hc/en-us/articles/360038511153-Create-a-new-file)). Figma's MCP `create_new_file` asks "which team or organization" when the user has several plans ([Figma MCP docs](https://developers.figma.com/docs/figma-mcp-server/skill-figma-create-new-file)).

**Admin disclosures.** Admins can turn AI content training on or off per team, workspace, or org ([AI settings](https://help.figma.com/hc/en-us/articles/17725942479127-Manage-AI-settings-and-content-training-for-your-team-or-organization)), and can view and export activity logs ([Activity logs](https://help.figma.com/hc/en-us/articles/360040449533-View-and-export-activity-logs)). I found no in-product "your admin can see…" notice.

---

## 2. Discord

**Switcher.** The **server list** is "the column on the very left-hand side … Any time you add a server, you'll see it pop up as a small circular icon," with servers stacked vertically. You drag to reorder or to group, and a **"+"** at the bottom creates or joins a server ([How do I join a Server?](https://support.discord.com/hc/en-us/articles/360034842871-How-do-I-join-a-Server)). **Server Folders** come from dragging one server onto another. Each folder can be renamed and given a colour, holds up to 100 servers, and offers **Folder Settings** and **Mark Server Folder as Read** on right-click ([Server Folders 101](https://support.discord.com/hc/en-us/articles/360030853132-Server-Folders-101)). The keyboard path is the **Quick Switcher** (⌘K / Ctrl+K), with prefix `*` for servers, `@` for DMs, `#` for text channels, and `!` for voice ([Quick Switcher](https://support.discord.com/hc/en-us/articles/115000070311-Quick-Switcher)). Ctrl+Alt+↑/↓ moves between servers ([Windows hotkeys](https://support.discord.com/hc/en-us/articles/225977308--Windows-Discord-Hotkeys)).

**Always-visible identity.** The current server's name sits "in the upper-left corner" over the channel list, and it opens the server dropdown ([Notifications Settings 101](https://support.discord.com/hc/en-us/articles/215253258-Notifications-Settings-101)). The selected server's icon carries a tall pill on its left edge, and the Discord-logo **Home** button at the top of the rail leads to Direct Messages **(unsourced, from product familiarity)**.

**Title.** Docs silent. The browser tab reads roughly "Discord | #channel | Server name" **(unsourced, from product familiarity)**.

**Accent.** Per-server identity comes from the server icon and banner. Users can wear a different face per server: a nickname for everyone, and a server avatar, banner, and About Me with Nitro (**Edit Per-server Profile**) ([Per-Server Profiles](https://support.discord.com/hc/en-us/articles/4409388345495-Per-Server-Profiles)). Folder colour is user-chosen ([Server Folders 101](https://support.discord.com/hc/en-us/articles/360030853132-Server-Folders-101)).

**Cross-server links.** For forwarded messages: "the link back to the original message is only visible to those who have access to the original server and channel, or if it's from a public server" ([Message Forwarding](https://support.discord.com/hc/en-us/articles/24640649961367-Message-Forwarding)). A message link into a server you aren't in got no clear error, according to a long-standing feature request ([community post](https://support.discord.com/hc/en-us/community/posts/360055299131-An-error-message-or-popup-for-when-you-can-t-jump-to-a-message-through-a-link)). Clicking a link inside a server you *are* in switches you to that server **(unsourced, from product familiarity)**. An invite link opens a pre-join screen where you can set your server nickname and DM/activity privacy before **Accept** ([join a Server](https://support.discord.com/hc/en-us/articles/360034842871-How-do-I-join-a-Server)).

**Moving.** No item moves between servers. **Forward** copies a message to up to 5 places. It is labelled "Forwarded," drops the original author, and doesn't update when the original is edited ([Message Forwarding](https://support.discord.com/hc/en-us/articles/24640649961367-Message-Forwarding)).

**Personal vs servers.** DMs live under Home, separate from servers. The Inbox's Mentions filter offers "Include all servers," and that option is hidden while you're viewing a DM ([Inbox FAQ](https://support.discord.com/hc/en-us/articles/360045027712-Inbox-FAQ)).

**Notifications from elsewhere.** This is the strongest pattern of the five. A mention "highlights it and adds a red badge to both the channel and the server" (quoted from a Discord help article surfaced in search, [support.discord.com/hc/en-us/articles/21084266106775](https://support.discord.com/hc/en-us/articles/21084266106775), now 404). "Notification badges on folders will let you know when any of your servers inside folders have notifications" ([Server Folders 101](https://support.discord.com/hc/en-us/articles/360030853132-Server-Folders-101)). An unread server shows a small white pill on the icon's left edge, and mentions show a red number badge **(unsourced, from product familiarity; users complain the tray badge no longer separates the two: [post](https://support.discord.com/hc/de/community/posts/360030933231-System-Tray-notification-badge-differentiate-mention-vs-unread-messages))**. The cross-server **Inbox** (⌘/Ctrl+I) has **Mentions** and **Unreads** tabs, a **Jump** button that "teleport[s] you directly to the channel," and **Mark Inbox As Read** ([Inbox FAQ](https://support.discord.com/hc/en-us/articles/360045027712-Inbox-FAQ)).

**Settings.** **User Settings** opens from "the cogwheel icon to the right of your avatar" ([Commands & Navigation Guide](https://support.discord.com/hc/en-us/articles/31232432266647-Discord-Commands-Shortcuts-and-Navigation-Guide)). Per-server controls live in the server-name dropdown, and Discord calls them "your personal Notification Settings within each server." Game-activity notifications, by contrast, are in **User Settings > Notifications** ([Notifications Settings 101](https://support.discord.com/hc/en-us/articles/215253258-Notifications-Settings-101)). So there are three tiers: account-wide (User Settings), per-server-for-me (Notification Settings, Per-server Profile), and per-server-for-admins (Server Settings).

**Breadcrumbs, create flow, admin disclosures.** No breadcrumb beyond the server name over the channel list. Creating a channel happens inside the current server **(unsourced, from product familiarity)**. Docs silent on admin-visibility notices.

---

## 3. Raycast

**Switcher: there isn't one.** Raycast merges personal and org items into one view. "Anything you share lives in your organization alongside your personal items, so members can tell at a glance what's theirs and what comes from the team" ([Shared Features](https://manual.raycast.com/teams/shared-features.md)).

**Always-visible identity.** Each item carries its org: "Shared Quicklinks show the organization's avatar on the right side of the item." **Search Quicklinks** has "the Organization filter in the Navigation Bar," and **Settings → Quicklinks** lists "your organization's Quicklinks … as a separate group from personal Quicklinks" ([Quicklinks](https://manual.raycast.com/quicklinks.md)). An org has a name, a handle (used in URLs such as `raycast.com/your_org/some_extension`), and an avatar ([Getting started with Teams (v1)](https://manual.raycast.com/v1/getting-started-with-teams)).

**Title / accent.** Not applicable (a launcher window has no title). The org avatar is the only per-org visual. Docs silent on an org colour.

**Cross-workspace links.** Docs silent.

**Moving.** Quicklinks have a **Move Quicklink** action: "When part of an organization, move Quicklinks between your personal account and organizations." Shared items get **Edit, Duplicate, Move, Delete** in the Action Panel (⌘K), and "Raycast asks for confirmation before destructive actions." The docs quote no move-confirmation copy ([Quicklinks](https://manual.raycast.com/quicklinks.md)). Docs silent on moving Snippets; the Snippets page mentions only choosing an Organization at creation ([Snippets](https://manual.raycast.com/snippets.md)).

**Personal vs team.** Shared items cover Snippets, Quicklinks, AI Commands, Agents, Dictation Styles, and private extensions. Skills are "Coming Soon" and "stay personal" for now ([Shared Features](https://manual.raycast.com/teams/shared-features.md)). "Members of any role can create, edit, and delete shared features" ([Roles & Permissions](https://manual.raycast.com/teams/roles-and-permissions.md)).

**Create flow: names the destination.** Snippets: "choose an **Organization** to decide whether the Snippet is personal or shared with your organization" ([Snippets](https://manual.raycast.com/snippets.md)). Quicklinks: "In **Organization**, select your organization," then **Save Quicklink** (⌘↵) "to publish" ([Quicklinks](https://manual.raycast.com/quicklinks.md)). This is a field in the create form, not a separate mode.

**Notifications.** Docs silent.

**Settings.** Account and organization settings (billing, members, **Copy Invite Link**, **Create an Organization**) are on the website at raycast.com/settings ([Account Management](https://manual.raycast.com/account-management.md)). Managers see members' name, email, role, and 2FA status ([Roles & Permissions](https://manual.raycast.com/teams/roles-and-permissions.md)).

**Admin disclosures.** Enterprise lets admins switch whole features off: Cloud Sync, Dictation, AI, AI Memory, and the provider allow-list ([Enterprise](https://manual.raycast.com/enterprise.md)). Docs silent on whether admins can see members' personal items.

---

## 4. Cursor

**Switcher: mostly none.** "On a Teams plan, a Cursor account is one team at a time. Leave your current team before joining another." Enterprise **Organizations** let a user "belong to multiple teams in the same org, with a different role in each" ([Teams setup](https://cursor.com/docs/account/teams/setup.md)), and each org has "a default team that acts as a stable home team for login and routing" ([Organizations](https://cursor.com/docs/enterprise/organizations.md)). Docs silent on any in-editor team switcher or team indicator. Cursor Settings → General shows the signed-in email and plan **(unsourced, from product familiarity)**. Joining a team "automatically cancel[s]" an individual Pro subscription ([Manage your team](https://cursor.com/help/account-and-billing/teams-management.md)). Personal and team are therefore exclusive states of one account rather than two places to switch between.

**Title / accent / breadcrumbs.** Docs silent. The window title is the VS Code-style file and folder, with no team **(unsourced, from product familiarity)**.

**Cross-workspace links.** Not applicable. Enterprise MDM can enforce `cursorAuth.allowedTeamId`, and "if a user tries to log in with a different team ID (like a personal account), Cursor logs them out immediately" ([Identity and access management](https://cursor.com/docs/enterprise/identity-and-access-management.md)).

**Team rules vs user rules.** Cursor's "move between scopes" story is about layering, not moving:
- **User Rules** live in "**Customize → Rules**" and apply across projects.
- **Team Rules** are created in the web dashboard.
- Precedence is "**Team Rules → Project Rules → User Rules**."
- An admin can tick **Enforce this rule**, which makes it "required for all team members and cannot be disabled in Customize." Unenforced rules can be toggled off "under **Team Rules** in Customize."

There is no move or promote action between user and team rules; the docs describe none ([Rules](https://cursor.com/docs/rules.md)).

**Settings split.** **Cursor Settings** (⌘⇧J) → **General** → **Privacy Mode** for the individual. "For teams, Privacy Mode is enabled by default for all team members. Admins can enforce it organization-wide via cursor.com/dashboard so members cannot disable it" ([Privacy and data](https://cursor.com/help/security-and-privacy/privacy.md)). Team settings (Privacy, usage-based pricing, Router, Marketplaces, SSO, Active Sessions, Repository Blocklist, and more) are web-only ([Dashboard](https://cursor.com/docs/account/teams/dashboard.md)). The toggle shows as locked or "enforced by your team" **(unsourced, from product familiarity)**. Bugbot has a matching split: **Team** settings in the dashboard, and **Personal settings** that "team members can override … for their own PRs" ([Bugbot](https://cursor.com/docs/bugbot.md)).

**Admin disclosures.** Members get "no access to billing settings or admin dashboard" and "can see their own usage" ([Members](https://cursor.com/docs/account/teams/members.md)). Admins see "individual member usage, total usage, and trends" ([Manage your team](https://cursor.com/help/account-and-billing/teams-management.md)). Profile visibility is capped by an admin **Profile visibility** policy (Private / Team / Public) ([Profiles](https://cursor.com/help/account-and-billing/profiles.md)).

**Notifications / create flow.** Docs silent.

---

## 5. ChatGPT (personal vs Business/Enterprise workspace)

**Switcher.** "Select your **profile icon** in ChatGPT. A list of your available workspaces will appear. Select the **workspace name**." You "immediately enter the selected workspace's environment, with its own conversations, settings, and resources." The help screenshot is captioned "workspace switcher menu with Enterprise Org selected over Personal account" ([What is a workspace / switch workspaces](https://help.openai.com/en/articles/8265430)). On the web the profile control sits at the bottom of the left sidebar and shows the workspace name **(unsourced, from product familiarity)**. Docs silent on a shortcut.

**Identity.** Owners set a **workspace name and image** in **Workspace settings > General**. "Changes apply across the workspace for all members" ([Managing workspace settings](https://help.openai.com/en/articles/8411955)). Docs silent on title or accent; the tab title is "ChatGPT" either way **(unsourced, from product familiarity)**.

**Cross-workspace links.** "If a shared link is opened by someone outside the workspace: They cannot see the shared chat. They are redirected to the ChatGPT home page with a message that they do not have access." The doc gives no prompt to switch workspaces. "If a viewer continues a shared conversation: A new private conversation is created in that viewer's workspace." Task links follow the same idea: "Business members can view a personal-account task link, but cannot schedule it in their Business workspace" ([Managing data, sharing, and privacy in Business](https://help.openai.com/en/articles/8798634-data-access-for-your-managed-chatgpt-account)).

**Moving.** Confirmed: chats can't be moved one at a time. The only path is a one-way bulk **merge**:
- Steps: **Settings > Data Controls**, then **Merge data from your personal workspace**, then **Merge**.
- "The migration flow does not let you select individual chats, projects, or files."
- "Migration does not provide an undo option."
- Afterwards the personal workspace "no longer appears in the workspace switcher."
- The confirmation dialog is titled **"Are you sure?"** with **Back** / **Start transfer**.
- What transfers: chats, custom GPTs (private stays private), projects you own (not ones shared with you), Library, automations, and cross-chat saved memories, which are added to the destination's memories and not merged into them ([Migrating your personal workspace](https://help.openai.com/en/articles/8801890)).
- "Merging is permanent and cannot be undone"; "Switching workspaces … does not move or copy data across workspaces" ([8265430](https://help.openai.com/en/articles/8265430)).

**Personal vs workspace.** Workspaces keep "separate conversations, custom GPTs, and files." In the workspace, "your conversations and files … are owned and managed by the organization" ([8265430](https://help.openai.com/en/articles/8265430)). Memory is per workspace. "If you choose not to merge, your personal workspace, conversations, and memories will remain separate and private." If an owner turns Memory off for the workspace, "existing saved memories for members in that workspace are deleted" ([Memory FAQ (Business)](https://help.openai.com/articles/9295112)).

**Settings split.** Profile icon → **Settings** for the user, and profile icon → **Workspace settings** (chatgpt.com/admin), which is "available to all roles" but editable by owners and admins. It has **General / Members / Groups / Permissions & roles**, the last covering models, GPTs, Memory, and link sharing. Plugin administration lives in a separate **Admin Console** (admin.openai.com) ([8411955](https://help.openai.com/en/articles/8411955)).

**Create flow.** A new chat silently goes to the current workspace; the docs describe no destination picker. The Codex-seat notice shows the pattern for gating by workspace: a user without ChatGPT access "will be notified that ChatGPT access is not available for their seat type" ([What is ChatGPT Enterprise?](https://help.openai.com/en/articles/8265053-what-is-chatgpt-enterprise)).

**Admin disclosures.** These are the most explicit of the five:
- "Each user has their own chat and Codex history. Other members do not automatically see those chats."
- "Usage analytics and spend controls are separate from chat transcript access."
- Members can't self-export; owners can, through **Members** → ⋯ → **Export data** ([8798634](https://help.openai.com/en/articles/8798634-data-access-for-your-managed-chatgpt-account)).
- Admins can enable an **AI policy modal**, "shown to users every 30 days" and again whenever it changes ([8411955](https://help.openai.com/en/articles/8411955)).
- On Enterprise, the Compliance API records "conversations, uploaded files, workspace GPT configuration and metadata, memories" ([OpenAI blog](https://openai.com/index/new-tools-for-chatgpt-enterprise)). "Only workspace owners can grant … access to Conversation messages" ([Admin keys](https://help.openai.com/en/articles/20001407-managing-admin-keys-in-admin-console)).

---

## Cross-product patterns

1. **The switcher sits on the identity control, top-left or bottom-left.** Figma uses its account name and team dropdown at top-left, ChatGPT its profile icon, Discord a dedicated left rail. Only Discord gives each workspace a persistent, always-visible slot. Discord and Figma both use Ctrl/⌘K-style search as the keyboard path; Discord's `*` prefix scopes it to servers.
2. **Two products avoid switching altogether, in different ways.** Raycast merges personal and org items in one list, tags each shared item with the org avatar, and offers an Organization filter. Cursor allows one team per account, so "which team" is a login fact rather than a UI state. Both suit a tool where the workspace is mostly a *source of shared configuration*, not a place you browse.
3. **Name and avatar identify a workspace far more often than colour.** No product themes the whole UI per workspace. Colour shows up only on user-chosen containers (Discord folders, Figma folders).
4. **No product puts the workspace in the window title.** Docs are silent across all five; by familiarity none does. A Mac app that wants the workspace in Mission Control or ⌘` would be doing something new.
5. **Cross-workspace links mostly fail closed instead of switching for you.** ChatGPT redirects home with a "no access" message. Discord shows a forwarded message's source link only to people with access. Figma routes access gaps to **Ask to edit** or guest approval. None of the docs describes an automatic "switch to workspace X?" prompt. Figma users explicitly ask for an account chooser on open.
6. **Moving between personal and team is either a per-item action or a one-way bulk migration.**
   - Per-item: Raycast **Move Quicklink**, Figma **Move file…**. Both are governed by access, and in Figma a move changes who can see the file.
   - One-way bulk: ChatGPT's irreversible merge, with an "Are you sure?" dialog.
   - Not possible: across Figma accounts or orgs, and per-chat in ChatGPT.
   - Cursor layers team rules over user rules by precedence instead of moving anything.
7. **The create flow names the destination only where items are cheap and shared.** Raycast puts an **Organization** field in the create form. Figma and ChatGPT create in the current context (Figma's default is Drafts).
8. **Personal space now lives inside the team.** Figma moved Drafts into each team in October 2025 because standalone drafts "made ownership unclear." ChatGPT keeps a separate "Personal account" in the switcher. Raycast shows personal and team items side by side.
9. **Cross-workspace notifications.** Discord badges every server icon and folder and adds a global Inbox. Figma shows one feed per account and hides other accounts' notifications. The rest are silent.
10. **Settings split by surface.** Account settings live in the app's profile menu. Workspace or admin settings live under a separate named entry (Figma **Admin**, ChatGPT **Workspace settings**, Discord's server dropdown), and in Cursor and Raycast on the website. Enforced team policy appears as a locked personal toggle (Cursor Privacy Mode, enforced Team Rules).
11. **ChatGPT is the reference for privacy disclosures.** It writes plain statements: who owns the data ("owned and managed by the organization"), what admins can't see ("do not automatically see those chats"), what analytics show, and a recurring 30-day policy modal. The others have admin controls but no member-facing disclosure in their docs.
