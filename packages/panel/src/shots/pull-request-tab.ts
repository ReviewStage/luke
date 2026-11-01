/**
 * pull-request-tab.ts -- 0.17.0 shot "A Pull request tab for every agent": #214's tab in a wide side panel on its Conversation, with its head, reviewers, description, Dana's review thread previewed with its diff, and Vercel's bot comment previewed with its diff.
 *
 * Throwaway (`README.md`). The plan open with the sidebar folded, the side
 * panel 900 points wide, the finished agent's pull request tab chosen once
 * its agent is listed. The tab's three reads (`CODING_AGENTS_OVERVIEW_*`)
 * each answer at once; every face is a member's picture or a
 * data URL.
 */

import { ACT_KIND } from "@luke/host/acts";
import { FIXTURE_CODE_PANEL } from "../tasks/tasks-fixture";
import { ago } from "./clock";
import { codingAgentAnswers } from "./coding-agent";
import { GITHUB } from "./github-people";
import { SHOT_ID, shotPlan, shotTasksView } from "./plan-document";
import type { ShotSpec } from "./shot-spec";
import { teamPlans } from "./team-world";
import { acmeMembers, MEMBER, whoWorkspaces } from "./who";

const URL = "https://github.com/acme/relay/pull/214";

/** `src/members/invite.ts` as #214 adds it, down to the line Dana asked about. */
const INVITE_LINES = [
  'import { db } from "../db";',
  'import { mail } from "../mail";',
  'import { DAY_MS, randomToken } from "../util";',
  "",
  "// How long an invite link stays good.",
  "export const INVITE_TTL_MS = 7 * DAY_MS;",
  "",
  "export async function inviteMember(workspaceId: string, email: string) {",
  "  const token = randomToken();",
  "  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);",
  '  const membership = await db.memberships.insert({ workspaceId, email, state: "pending", inviteToken: token, expiresAt });',
  "  await mail.invite(email, acceptUrl(token));",
  "  return membership;",
  "}",
  "",
  "export async function withdrawInvite(inviteId: string, by: Member) {",
  "  const invite = await db.memberships.find(inviteId);",
  "  assertSenderOrAdmin(invite, by);",
  '  await db.memberships.update(inviteId, { state: "withdrawn" });',
];

const HUNK = `@@ -0,0 +1,${String(INVITE_LINES.length)} @@\n${INVITE_LINES.map((line) => `+${line}`).join("\n")}`;

const DESCRIPTION =
  "<h2>Summary</h2>" +
  "<p>A member invites a teammate by email, and the teammate joins by opening the link.</p>" +
  "<ul>" +
  "<li>An invite is a <code>memberships</code> row with <code>state = pending</code></li>" +
  "<li><code>POST /invites</code> creates it and mails a one-time link that lasts 7 days</li>" +
  "<li>The three reads that counted members skip pending rows</li>" +
  "</ul>";

const VERCEL_COMMENT =
  "<p>The latest updates on your projects.</p>" +
  "<table><thead><tr><th>Name</th><th>Status</th><th>Preview</th></tr></thead>" +
  '<tbody><tr><td><strong>relay</strong></td><td>✅ Ready</td><td><a href="https://relay-git-luke-teammate-invitations-acme.vercel.app">Visit Preview</a></td></tr></tbody></table>';

export function pullRequestTabShot(): ShotSpec {
  const members = acmeMembers();
  return {
    planning: shotTasksView({
      plan: shotPlan({ ownerId: MEMBER.DEAN.userId, createdBy: MEMBER.DEAN }),
      plans: teamPlans(),
      extra: { workspaces: whoWorkspaces(members.length) },
    }),
    sidePanel: { ...FIXTURE_CODE_PANEL, width: 900 },
    readerId: MEMBER.DEAN.userId,
    answers: {
      ...codingAgentAnswers(),
      [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => members,
      [ACT_KIND.CODING_AGENTS_OVERVIEW_PULL_REQUEST]: (payload) =>
        payload.agentId !== SHOT_ID.AGENT
          ? undefined
          : {
              pullRequest: {
                number: 214,
                title: "Add teammate invitations",
                url: URL,
                state: "open",
                html: DESCRIPTION,
                base: "main",
                head: "luke/teammate-invitations",
                createdAt: ago(31),
                mergedAt: null,
                merge: "clean",
                author: GITHUB.DEAN,
                writtenAs: "developer",
                requested: [GITHUB.JORDAN],
              },
            },
      [ACT_KIND.CODING_AGENTS_OVERVIEW_CONVERSATION]: (payload) =>
        payload.agentId !== SHOT_ID.AGENT
          ? undefined
          : {
              pullRequest: {
                reviewers: [
                  { by: GITHUB.DANA, state: "approved" },
                  { by: GITHUB.JORDAN, state: "requested" },
                ],
                earlier: 0,
                conversation: [
                  {
                    kind: "review",
                    by: GITHUB.DANA,
                    state: "approved",
                    html: "<p>Reads well. One question on withdraw before it merges.</p>",
                    body: "Reads well. One question on withdraw before it merges.",
                    at: ago(17),
                    url: `${URL}#pullrequestreview-2384170002`,
                    threads: [
                      {
                        id: "thread-withdraw",
                        path: "src/members/invite.ts",
                        line: INVITE_LINES.length,
                        startLine: null,
                        originalLine: INVITE_LINES.length,
                        originalStartLine: null,
                        side: "right",
                        startSide: null,
                        diffHunk: HUNK,
                        resolved: false,
                        outdated: false,
                        more: 0,
                        comments: [
                          {
                            by: GITHUB.DANA,
                            html: "<p>Should withdrawing also clear <code>invite_token</code>, so an old link can never be replayed?</p>",
                            body: "Should withdrawing also clear invite_token, so an old link can never be replayed?",
                            at: ago(17),
                            url: `${URL}#discussion_r2384170003`,
                          },
                          {
                            by: GITHUB.DEAN,
                            html: "<p>Cleared in 4f1c2a9: <code>withdrawInvite</code> now nulls the token, and a test opens the old link.</p>",
                            body: "Cleared in 4f1c2a9: withdrawInvite now nulls the token, and a test opens the old link.",
                            at: ago(14),
                            url: `${URL}#discussion_r2384170004`,
                          },
                        ],
                      },
                    ],
                  },
                  {
                    kind: "comment",
                    by: GITHUB.VERCEL,
                    html: VERCEL_COMMENT,
                    body: "The latest updates on your projects.",
                    at: ago(13),
                    url: `${URL}#issuecomment-2384170001`,
                  },
                ],
              },
            },
      [ACT_KIND.CODING_AGENTS_OVERVIEW_CHECKS]: (payload) =>
        payload.agentId !== SHOT_ID.AGENT
          ? undefined
          : {
              pullRequest: {
                checks: [
                  { name: "test", app: "GitHub Actions", state: "passed", url: null, startedAt: ago(30), completedAt: ago(27) },
                  { name: "lint", app: "GitHub Actions", state: "passed", url: null, startedAt: ago(30), completedAt: ago(29) },
                ],
              },
            },
    },
    layout: { sidebarCollapsed: true, sidePanelTabs: [{ changes: SHOT_ID.AGENT }] },
  };
}
