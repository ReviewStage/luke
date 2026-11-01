/**
 * chapters.ts -- 0.19.0 shot "Pull request chapters": #214's Chapters tab over the whole window, its rail of four chapters beside the second, the high-risk one, with its summary, key changes, and its own hunks.
 *
 * Throwaway (`README.md`). The sidebar folded and the side panel full screen
 * on #214's Pull request tab, chosen on Chapters by one step once the agent
 * is listed. The chapters are told by Opus 5.5 at #214's head, so none reads
 * stale; every hunk of `pr-214.ts` stands in exactly one chapter, and the
 * first chapter's files are viewed, so its rail row wears the ✓.
 */

import { CHAPTERS_MODEL } from "@luke/features/chapters-model-choice";
import type { Chapter } from "@luke/features/pull-request-chapters";
import { ACT_KIND } from "@luke/host/acts";
import { FIXTURE_CODE_PANEL } from "../tasks/tasks-fixture";
import { PULL_REQUEST_VIEW } from "../tasks/use-side-panel";
import { SHOT_ID, shotPlan, shotTasksView } from "./plan-document";
import { BASE_SHA, HEAD_SHA, INVITE_PATH } from "./pr-214";
import { pr214TabAnswers } from "./pr-214-tab";
import type { ShotSpec, ShotStep } from "./shot-spec";
import { teamPlans } from "./team-world";
import { acmeMembers, MEMBER, whoWorkspaces } from "./who";

const MIGRATION = "src/db/migrations/20261013_memberships_state.sql";
const SCHEMA = "src/db/schema/memberships.ts";

const CHAPTERS: Chapter[] = [
  {
    kind: "story",
    title: "Pending memberships",
    summary:
      "An invite is a `memberships` row before it is a member: a `state` of `pending`, `active`, or `withdrawn`, the one-time `invite_token`, who sent it, and when its link expires.",
    hunkRefs: [
      { path: MIGRATION, oldStart: 0 },
      { path: SCHEMA, oldStart: 6 },
    ],
    keyChanges: [
      {
        content: "`state` defaults to `active`, so every existing row stays a member without a backfill.",
        lineRefs: [{ path: SCHEMA, side: "additions", startLine: 9, endLine: 9 }],
      },
    ],
    risk: "medium",
    riskReasons: ["A migration on the table every request reads"],
  },
  {
    kind: "story",
    title: "Invite, withdraw, accept",
    summary:
      "`POST /invites` makes the pending row and mails the link; `/invites/:token` turns it active, or answers **This invite is no longer valid** with a 410 once it was withdrawn, accepted, or expired. Only the sender or an admin may withdraw.",
    hunkRefs: [
      { path: INVITE_PATH, oldStart: 0 },
      { path: "src/members/accept.ts", oldStart: 0 },
      { path: "src/routes/invites.ts", oldStart: 0 },
    ],
    keyChanges: [
      {
        content: "Withdrawing and accepting both clear `invite_token`, so a link works once.",
        lineRefs: [
          { path: INVITE_PATH, side: "additions", startLine: 21, endLine: 21 },
          { path: "src/members/accept.ts", side: "additions", startLine: 8, endLine: 12 },
        ],
      },
      {
        content: "An expired link is refused before the row is touched.",
        lineRefs: [{ path: "src/members/accept.ts", side: "additions", startLine: 7, endLine: 7 }],
      },
    ],
    risk: "high",
    riskReasons: [
      "The accept link is a bearer token: a replayed or expired one must never activate",
      "Withdraw is gated on the sender or an admin",
    ],
  },
  {
    kind: "story",
    title: "Count active members",
    summary:
      "The three reads that counted members (the members list, seats on the invoice, and workspace access) now skip pending and withdrawn rows.",
    hunkRefs: [
      { path: "src/members/list.ts", oldStart: 5 },
      { path: "src/billing/seats.ts", oldStart: 19 },
      { path: "src/auth/workspace-access.ts", oldStart: 32 },
    ],
    keyChanges: [
      {
        content: "A pending invite no longer opens the workspace or takes a seat.",
        lineRefs: [{ path: "src/auth/workspace-access.ts", side: "additions", startLine: 33, endLine: 37 }],
      },
    ],
    risk: "low",
    riskReasons: ["The same filter in three places"],
  },
  {
    kind: "other",
    title: "Other changes",
    summary: "Tests for invite, accept, and withdraw.",
    hunkRefs: [{ path: "src/members/invite.test.ts", oldStart: 0 }],
    keyChanges: [],
    risk: null,
    riskReasons: [],
  },
];

/** Opens #214's Pull request tab on Chapters, once the agent is listed. */
const OPEN_CHAPTERS: ShotStep = {
  key: "pull-request-chapters",
  ready: ({ plans }) => plans.agents.agentIds?.includes(SHOT_ID.AGENT) ?? false,
  run: ({ plans }) => {
    plans.sidePanel.onPullRequestView({ changes: SHOT_ID.AGENT }, PULL_REQUEST_VIEW.CHAPTERS);
    plans.sidePanel.onChoose({ changes: SHOT_ID.AGENT });
  },
};

export function chaptersShot(): ShotSpec {
  const members = acmeMembers();
  return {
    planning: shotTasksView({
      plan: shotPlan({ ownerId: MEMBER.DEAN.userId, createdBy: MEMBER.DEAN }),
      plans: teamPlans(),
      extra: { workspaces: whoWorkspaces(members.length) },
    }),
    sidePanel: { ...FIXTURE_CODE_PANEL, width: 1000 },
    readerId: MEMBER.DEAN.userId,
    answers: {
      ...pr214TabAnswers({ viewed: new Set([MIGRATION, SCHEMA]) }),
      [ACT_KIND.CHAPTERS_READ]: (payload) =>
        payload.agentId !== SHOT_ID.AGENT
          ? undefined
          : {
              pullRequest: {
                number: 214,
                headSha: HEAD_SHA,
                generatable: true,
                chapters: {
                  status: "ready",
                  headSha: HEAD_SHA,
                  baseSha: BASE_SHA,
                  model: CHAPTERS_MODEL.OPUS,
                  chapters: CHAPTERS,
                },
              },
            },
    },
    chapter: 1,
    layout: { sidebarCollapsed: true, sidePanelFullScreen: true },
    steps: [OPEN_CHAPTERS],
  };
}
