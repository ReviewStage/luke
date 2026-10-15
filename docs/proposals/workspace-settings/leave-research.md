# Leaving a workspace, transferring ownership, and picking a role on invite

Researched 2026-10-15 from official help centers and docs; every page cited below was fetched. Anything a fetched doc doesn't say is marked *(inferred)* or "undocumented".

## Linear

1. **Leave.** You leave from your own account settings, not from the member list: "To leave the workspace, click the **Leave workspace** option in *Settings > Profile*" (the screenshot is captioned "Remove yourself from workspace"). The doc describes no confirmation dialog, and doesn't list what you lose.
2. **What you created.** Leaving works like a suspension: "An admin will have to unsuspend your account in order for you to log back in." For suspended users: "They remain visible in the members list for historical purposes—for example, when viewing issues they created or were assigned to." Issues stay with the workspace and are not reassigned *(inferred from the suspension text)*. API tokens: "What happens to API tokens when a user is suspended or converted to a guest? The API tokens will be revoked and invalidated." Integrations and webhooks you set up: undocumented.
3. **Rules.** Owner is an Enterprise-only role ("The workspace owner role is only available on Enterprise plans"). On Free, "All workspace members become admins automatically". No doc covers the last admin or owner leaving. There is no primary-owner concept. Workspace deletion is separate: an owner (or an admin, if workspace restrictions allow) requests it, confirms with an emailed code, and the deletion runs after a 48-hour window that any admin can cancel.
4. **Transfer.** There is no transfer flow. You change roles instead (see 8).
5. **After leaving.** Undocumented.
6. **Edge cases.** To rejoin you need an admin to unsuspend you. On SAML workspaces, "Users who have access to Linear through your IdP may login to the workspace without needing an invitation", and under SCIM, "Members and Admins are managed through your identity provider." Pending invites after leaving, and leaving offline: undocumented.
7. **Invite role.** Settings > Administration > Members, then **Invite**, then email addresses separated by commas. "Under **Invite as...**, select the role you want the invitee(s) to have when joining the workspace (*paid plans*)". You can also pick teams, then click **Send invites**. The doc doesn't say what kind of control "Invite as..." is or what it defaults to; a select defaulting to Member is *(inferred)*. On paid plans, "By default, only Admins can invite members".
8. **Role changes.** Admins and owners do this in Settings > Administration > Members: "Hover over a member's row → Click the **overflow menu (⋯)** → Select the **Change role...**". **Suspend user...** is in the same ⋯ menu. Enterprise owners "can configure which roles can perform certain workspace-level actions".

## Vercel

1. **Leave.** You leave from a section on the team's settings page: "Go to your team's dashboard and open **Settings** → Scroll to the **Leave Team** section and select the **Leave Team** button → Click **Confirm**." That is a plain confirm. The Members page's ⋯ menu also has **Remove from Team**, and "You can also remove yourself from a team."
2. **What you created.** Projects and deployments belong to the team and stay with it *(inferred)*. Integrations are documented in detail: "Every integration installed for a team creates an access token that is associated with the developer who originally installed it. If the developer loses access to the team, the integration will become disabled… We will notify team owners." An owner must "either chang[e] ownership or remov[e] the integration." Also: "If a disabled integration is not re-enabled, it will be automatically removed after 30 days. Any environment variables that were created by that integration will also be removed - this may prevent new deployments from working." While an integration is disabled its log drains stop and it gets almost no webhooks. Personal access tokens: undocumented.
3. **Rules.** "You can't leave a team if you are the last remaining owner or the last confirmed member." "If there isn't another owner for your team, you must assign a different confirmed member as the team owner." "If you are the only remaining member, you should delete the team instead." There is no primary owner.
4. **Transfer.** Transfer means promoting someone and then demoting or removing yourself. On Members, click **Manage Role** next to the member, choose "Owner" from the dropdown, and confirm. "Only an Owner can change roles or remove members." Anyone can receive it, existing member or new invitee. The old owner is not demoted automatically; they "Click 'Manage Role,' choose 'Member'". "Vercel blocks a member from leaving the team or being removed from it while they're the last remaining Owner." Owner changes are not allowed during a Pro trial.
5. **After leaving.** "If you delete, leave, or are removed from your default team, Vercel will automatically choose a new default team for you." No toast or email is documented.
6. **Edge cases.** Invites expire after 7 days (30 days on SAML-enforced teams), and expired ones appear in **Pending Invitations**. Under SCIM, "de-provisioning from the third-party provider will also remove the member." Rejoining is by a new invite, or automatically through Git-committer Auto Approval. Leaving offline: undocumented.
7. **Invite role.** Members settings: "Enter the email address… assign their role, and select the **Invite** button. You can invite multiple people at once using the **Add more** button." "By default only the team level roles are visible in the dropdown." So the role is a dropdown on the same row as the email. Choosing Contributor reveals **Assign Project Roles**. The default role isn't documented; Member is *(inferred)*.
8. **Role changes.** Owners only, through the **Manage Role** button beside the role in the row (not inside a ⋯ menu). Remove is in the ⋯ menu.

## Slack

1. **Leave.** In Slack, leaving a workspace means deactivating your account in it. In Account settings (my.slack.com/account), click **Deactivate your account**, enter your password and click **Confirm Password**, then click **Yes, deactivate my account**. That is password re-entry plus a second confirm. "If you belong to several workspaces… you'll need to deactivate each account separately." In an Enterprise org the option may not appear if membership is required.
2. **What you created.** "Messages and files you've sent won't be deleted." Apps you installed "may be disabled. A Workspace Owner will be able to manage and re-enable them." In more detail: "some apps they've installed (whether third-party or custom) will automatically deactivate", while "bot users, slash commands, and incoming webhooks will remain active". Also, "API tokens are revoked as well. Any user-specific permissions granted by a member will no longer be available." A reactivated bot gets a regenerated token, so code using the old one must be updated. An internal app whose collaborators were all deactivated needs an owner to add a collaborator before it can be reactivated.
3. **Rules.** Slack has a real **Primary Owner** concept: one per workspace, and "Only this person can delete the workspace or transfer ownership". "Workspace Primary Owners can't deactivate their accounts" until they transfer. Ordinary Owners and Admins can leave freely *(inferred: no restriction is documented)*.
4. **Transfer.** A dedicated transfer-ownership page: "Search for and select the member you'd like to be the new Workspace Primary Owner" → "Enter your password to confirm the transfer" → **Transfer Workspace Ownership**. Any member can receive it. "Your role will change from Primary Owner to Owner", and the change takes effect immediately. If the Primary Owner is gone, Slack Support steps in only for workspaces created for a legal entity.
5. **After leaving.** "Your account will be deactivated immediately." Where you land: undocumented. Profile data stays until the Primary Owner deletes it.
6. **Edge cases.** To rejoin, "a Workspace Owner or Admin will need to reactivate your account." Invite links are unavailable under SSO. Pending invites and leaving offline: undocumented.
7. **Invite role.** Open the workspace menu, choose **Invite people to…**, enter emails, then **Send**. "Owners and admins see a drop-down menu to choose whether to invite members or guests." So the account type is a dropdown in the invite dialog. The default isn't documented; Member is *(inferred)*. You can't invite someone as Admin or Owner; you promote them after they join.
8. **Role changes.** Admin → Workspace settings → People → "three dots icon next to the member" → **Change account type** → **Save**. Promote to Owner: Owners and the Primary Owner. Demote an Owner: Primary Owner only. Promote to Admin: Admins, Owners, and the Primary Owner. Demote an Admin: Owners and the Primary Owner. Slack warns: "Proceed with caution when promoting members to owner or admin roles… [you] may be unable to demote them later."

## Notion

1. **Leave.** Settings → Workspace → General → **Danger zone** → **Leave workspace**. The warning: "You'll lose access to all of the content inside it. You might want to export any data that you want to keep." The confirmation dialog's wording isn't documented.
2. **What you created.** For a removed member, the Private pages in their sidebar are hidden, and "If someone leaves and rejoins within 30 days… their private pages, shared pages, group membership, and teamspace membership will be restored." Custom Agents: "Transferring ownership ensures business-critical agents continue running when users leave the workspace… After 7 days of no ownership, the agent stops running." An admin reassigns them under Settings → Members → **Recently Left**. Integrations: undocumented.
3. **Rules.** "Every workspace has at least one owner." So the sole owner presumably can't leave until they promote someone *(inferred)*. There is no primary owner.
4. **Transfer.** No transfer flow; you promote someone to Workspace owner from the role dropdown ("Members can be turned into workspace owners"). Whether the old owner is demoted is undocumented; nothing is automatic *(inferred)*.
5. **After leaving.** "The workspace is removed from your workspace switcher." Landing and notifications: undocumented.
6. **Edge cases.** You rejoin by being re-added, or through **Join or create workspace** when your domain auto-joins. The 30-day restore window above also applies. SSO and offline: undocumented.
7. **Invite role.** Settings → People/Members → Members tab → **Add members** → enter an email, "select whether to add them as a `Workspace owner`, `Membership admin`, or `Member` from the dropdown," then **Invite**. The default isn't documented.
8. **Role changes.** Inline: "Open the dropdown for the member's role" in their row. **Remove from workspace** is in the same dropdown. Owners "manage other workspace owners, admins, members". Membership admins (Enterprise) "can add or remove members… but [can't] change workspace settings."

## GitHub organizations

1. **Leave.** From your own account: Settings → Access → **Organizations** → **Leave** next to the org. The confirmation isn't documented.
2. **What you created.** Removed members "lose access to private forks of your organization's private repositories". Repos belong to the org. Pending invitations the leaver sent are canceled. "Removing yourself… does not update the billing information on file."
3. **Rules.** "We recommend that at least two people within each organization have the owner role." To transfer, "If you're the only member with owner privileges, give another organization member the owner role." Whether a sole owner is blocked from leaving isn't documented; the UI blocking it is *(inferred)*. There is no primary owner.
4. **Transfer.** Add an owner, have billing updated, then "remove yourself from the organization." The old owner is removed, not demoted. Any member can be promoted.
5. **After leaving.** Undocumented.
6. **Edge cases.** "Their membership data is saved for three months." On re-invite you choose **Invite and reinstate** (role, teams, repo access, private forks, issue assignments) or **Invite and start fresh**. Invites expire after seven days. Enterprise Managed Users are provisioned by SCIM and not invited.
7. **Invite role.** People → **Invite member** → search by username or email → **Invite** → choose "Role in the organization" → optionally pick teams → **Send invitation**. This is a separate dialog step after picking the person. The doc doesn't name the control; radio buttons are *(inferred)*. The default role is member: "The default, non-administrative role for people in an organization is the organization member."
8. **Role changes.** Owners only: "As an organization owner, you can change the role of other organization members and owners. You can't change your own role." It's a bulk action: select members, open "X members selected…", choose **Change role**, then confirm with **Change role**.

## Figma (quick)

To leave: team dropdown → **View members** → the dropdown by your name → **Leave**. "If you are the owner of any team files or folders, Figma will transfer ownership of those folders or files to the current owner of the team when you leave." "If you're the last member of the team, Figma will delete the team" (restorable for 28 days). To transfer: Share → change a person's dropdown to **Owner** → **Transfer ownership**. Only the owner can transfer, to "any existing team member". "You will stay on the team as a team admin". The transfer can't be undone, but the new owner can transfer again.

## Synthesis

**Leave and transfer.**
- Leave lives in one of two places. It's either the leaver's own settings (Linear's Profile, Slack's Account, GitHub's Organizations list) or a danger-zone section at the bottom of workspace settings (Vercel's Leave Team, Notion's Danger zone). Only Figma puts it in your own row of the member list.
- Confirmation is light, usually a single Confirm. Slack is the exception and asks for your password, because leaving there is account deactivation. Nobody asks you to type the workspace's name to leave; type-to-confirm is kept for deletion.
- Content stays with the workspace in every product, and nothing is reassigned except in Figma, where owned files go to the team owner. Your identity stays attached to what you made, shown as a suspended or deactivated user.
- What dies is what was tied to your personal credential: Linear and Slack revoke API tokens. Vercel disables integrations you installed, notifies owners, and deletes them after 30 days. Slack disables some apps but keeps bots, slash commands, and incoming webhooks alive. Notion's agents stop after 7 days with no owner.
- The last owner can never leave. Vercel enforces this outright (it also blocks the last confirmed member and points the sole member to delete instead). Slack blocks the Primary Owner. Notion and GitHub imply it ("at least one owner", "give another member the owner role").
- Transfer comes in two shapes. One is promote-then-step-down (Vercel, Notion, GitHub, Linear), where the old owner keeps the role until they demote or remove themselves. The other is a dedicated one-way handoff (Slack, Figma) for a singular owner, which demotes the old owner one step automatically (Primary Owner to Owner, Owner to Admin), confirmed with a password in Slack's case. Any member can receive ownership; no product requires the recipient to be an admin first.
- Rejoining is admin-gated: Linear unsuspends, Slack reactivates. GitHub (3 months) and Notion (30 days) keep a restore window that brings back your prior access.

**Invite-role control.**
- The role is almost always a dropdown in the same form as the email field: Vercel puts it on each row, Notion beside the field, Linear under "Invite as...", Slack as a member/guest dropdown.
- GitHub is the outlier: you pick the person first, then choose "Role in the organization" as a separate step.
- The default is the plain member role (GitHub documents it; elsewhere it's *(inferred)*).
- Owner can be granted at invite time in Vercel and Notion. Slack only offers member or guest at invite, and you promote after joining.

**Who changes roles.**
- In most products, owners or admins change roles from a row control. It's either an inline role dropdown or button (Notion, Vercel's **Manage Role**) or a ⋯ menu item ("Change role...", Slack's "Change account type").
- Strict hierarchy is common. GitHub and Vercel reserve role changes for owners. Slack lets admins promote admins but only owners demote them, and only the Primary Owner demotes owners.
- Several products bar changing your own role (GitHub says so outright) and warn that promotions may be irreversible (Slack, Figma).

## Sources

- https://linear.app/docs/profile
- https://linear.app/docs/members-roles
- https://linear.app/docs/invite-members
- https://linear.app/docs/workspaces
- https://vercel.com/docs/accounts/create-a-team (served as /docs/accounts: "Leaving a team", "Default team")
- https://vercel.com/docs/rbac/managing-team-members
- https://vercel.com/kb/guide/how-do-i-transfer-ownership-of-a-vercel-team
- https://vercel.com/docs/integrations/install-an-integration/manage-integrations-reference
- https://slack.com/help/articles/203953146-Deactivate-your-Slack-account
- https://slack.com/help/articles/204401633-Transfer-ownership-of-a-workspace-or-org
- https://slack.com/help/articles/218124397-Change-a-members-role
- https://slack.com/help/articles/360018112273-Types-of-roles-in-Slack
- https://slack.com/help/articles/201330256-Invite-new-members-to-your-workspace
- https://slack.com/help/articles/360000446446-Manage-deactivated-members-apps-and-integrations
- https://www.notion.com/help/create-delete-and-switch-workspaces
- https://www.notion.com/help/add-members-admins-guests-and-groups
- https://www.notion.com/help/whos-who-in-a-workspace
- https://www.notion.com/help/custom-agents-sharing-and-permissions
- https://docs.github.com/en/account-and-profile/setting-up-and-managing-your-personal-account-on-github/managing-your-membership-in-organizations/removing-yourself-from-an-organization
- https://docs.github.com/en/organizations/managing-organization-settings/transferring-organization-ownership
- https://docs.github.com/en/organizations/managing-peoples-access-to-your-organization-with-roles/maintaining-ownership-continuity-for-your-organization
- https://docs.github.com/en/organizations/managing-peoples-access-to-your-organization-with-roles/roles-in-an-organization
- https://docs.github.com/en/organizations/managing-membership-in-your-organization/inviting-users-to-join-your-organization
- https://docs.github.com/en/organizations/managing-membership-in-your-organization/removing-a-member-from-your-organization
- https://docs.github.com/en/organizations/managing-membership-in-your-organization/reinstating-a-former-member-of-your-organization
- https://help.figma.com/hc/en-us/articles/360039965653-Leave-a-team
- https://help.figma.com/hc/en-us/articles/360039481134-Transfer-ownership-of-a-team
