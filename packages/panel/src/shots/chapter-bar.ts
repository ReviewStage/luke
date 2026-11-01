/**
 * chapter-bar.ts -- 0.24.0 shot "Chapters under one bar": #214's Chapters with the side panel full screen, its first of eight chapters under the bar (title, risk, Viewed, the pager), the rail listing the eight, and the chapter's summary with its file pills.
 *
 * Throwaway (`README.md`). 0.19.0's four chapters cut finer, one per part of
 * #214, so the pager reads "1 of 8" and every hunk of `pr-214.ts` stands in
 * exactly one chapter; the tests are Other changes in the product's own words.
 * Dean viewed the schema, the members list, and seats, so the first chapter's
 * Viewed reads 1/2 and the fifth and sixth rows wear their ✓. Framed as a
 * close-up of the panel, unlike 0.19.0's whole window filled by it.
 */

import { CHAPTERS_MODEL } from "@luke/features/chapters-model-choice";
import { type Chapter, otherChangesChapter } from "@luke/features/pull-request-chapters";
import { ACT_KIND } from "@luke/host/acts";
import { FIXTURE_CODE_PANEL } from "../tasks/tasks-fixture";
import { PULL_REQUEST_VIEW } from "../tasks/use-side-panel";
import { standingPlan, standingPlans } from "./board";
import { ago } from "./clock";
import { SHOT_ID, shotTasksView } from "./plan-document";
import { BASE_SHA, HEAD_SHA, INVITE_PATH } from "./pr-214";
import { pr214TabAnswers } from "./pr-214-tab";
import type { ShotSpec, ShotStep } from "./shot-spec";
import { acmeMembers, MEMBER, whoWorkspaces } from "./who";

const MIGRATION = "src/db/migrations/20261013_memberships_state.sql";
const SCHEMA = "src/db/schema/memberships.ts";
const ACCEPT = "src/members/accept.ts";
const ROUTES = "src/routes/invites.ts";
const LIST = "src/members/list.ts";
const SEATS = "src/billing/seats.ts";
const ACCESS = "src/auth/workspace-access.ts";

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
      {
        content: "`invite_token` is unique, so one link names one invite.",
        lineRefs: [{ path: SCHEMA, side: "additions", startLine: 10, endLine: 10 }],
      },
    ],
    risk: "medium",
    riskReasons: ["A migration on the table every request reads"],
  },
  {
    kind: "story",
    title: "Invite and withdraw",
    summary:
      "`inviteMember` makes the pending row and mails the link; `withdrawInvite` ends it. Only the sender or an admin may withdraw.",
    hunkRefs: [{ path: INVITE_PATH, oldStart: 0 }],
    keyChanges: [
      {
        content: "Withdrawing clears `invite_token`, so an old link can never be replayed.",
        lineRefs: [{ path: INVITE_PATH, side: "additions", startLine: 21, endLine: 21 }],
      },
      {
        content: "Withdraw is refused to anyone but the sender or an admin.",
        lineRefs: [{ path: INVITE_PATH, side: "additions", startLine: 20, endLine: 20 }],
      },
    ],
    risk: "high",
    riskReasons: ["Withdraw is gated on the sender or an admin"],
  },
  {
    kind: "story",
    title: "Accept an invite",
    summary: "`acceptInvite` turns a pending row active once, clearing its token, and refuses an expired link.",
    hunkRefs: [{ path: ACCEPT, oldStart: 0 }],
    keyChanges: [
      {
        content: "An expired link is refused before the row is touched.",
        lineRefs: [{ path: ACCEPT, side: "additions", startLine: 7, endLine: 7 }],
      },
      {
        content: "Accepting clears `invite_token`, so a link works once.",
        lineRefs: [{ path: ACCEPT, side: "additions", startLine: 8, endLine: 12 }],
      },
    ],
    risk: "high",
    riskReasons: ["The accept link is a bearer token: a replayed or expired one must never activate"],
  },
  {
    kind: "story",
    title: "Invite routes",
    summary:
      "`POST /invites` and `/invites/:token`, the latter answering **This invite is no longer valid** with a 410.",
    hunkRefs: [{ path: ROUTES, oldStart: 0 }],
    keyChanges: [
      {
        content: "A withdrawn, accepted, or expired link answers 410.",
        lineRefs: [{ path: ROUTES, side: "additions", startLine: 19, endLine: 19 }],
      },
    ],
    risk: "medium",
    riskReasons: ["A public route that reads a token"],
  },
  {
    kind: "story",
    title: "Members list counts active",
    summary: "The members list skips pending and withdrawn rows.",
    hunkRefs: [{ path: LIST, oldStart: 5 }],
    keyChanges: [
      {
        content: "Pending invites are listed beside members, not among them.",
        lineRefs: [{ path: LIST, side: "additions", startLine: 5, endLine: 8 }],
      },
    ],
    risk: "low",
    riskReasons: ["One filter"],
  },
  {
    kind: "story",
    title: "Seats count active",
    summary: "A pending invite takes no seat on the invoice.",
    hunkRefs: [{ path: SEATS, oldStart: 19 }],
    keyChanges: [
      {
        content: "`seatCount` counts active rows alone.",
        lineRefs: [{ path: SEATS, side: "additions", startLine: 22, endLine: 22 }],
      },
    ],
    risk: "low",
    riskReasons: ["One filter"],
  },
  {
    kind: "story",
    title: "Workspace access",
    summary: "A pending or withdrawn row no longer opens the workspace.",
    hunkRefs: [{ path: ACCESS, oldStart: 32 }],
    keyChanges: [
      {
        content: "`memberOf` answers no for anything but an active row.",
        lineRefs: [{ path: ACCESS, side: "additions", startLine: 33, endLine: 37 }],
      },
    ],
    risk: "medium",
    riskReasons: ["Every request's access check"],
  },
  otherChangesChapter([{ path: "src/members/invite.test.ts", oldStart: 0 }]),
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

export function chapterBarShot(): ShotSpec {
  const members = acmeMembers();
  return {
    planning: shotTasksView({
      plan: standingPlan(),
      plans: standingPlans(),
      extra: { workspaces: whoWorkspaces(members.length) },
    }),
    sidePanel: { ...FIXTURE_CODE_PANEL, width: 1000 },
    readerId: MEMBER.DEAN.userId,
    answers: {
      ...pr214TabAnswers({ viewed: new Set([SCHEMA, LIST, SEATS]) }),
      [ACT_KIND.AGENTS_OVERVIEW_CHECKS]: (payload) =>
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
      [ACT_KIND.CHAPTERS_READ]: (payload) =>
        payload.agentId !== SHOT_ID.AGENT
          ? undefined
          : {
              pullRequest: {
                number: 214,
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
    chapter: 0,
    layout: { sidebarCollapsed: true },
    steps: [OPEN_CHAPTERS],
  };
}
