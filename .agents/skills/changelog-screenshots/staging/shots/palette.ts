/**
 * palette.ts -- shot L, "A command palette": ⌘K open over the plan, "invite" typed, matching a plan, the plan's agents and a subagent, and files of its repository.
 *
 * Throwaway (`README.md`). The side panel is closed and the palette stands
 * on All, its filter chips showing. The files are a canned listing of
 * acme/relay; the subagent is a worker of Luke's on the plan's last call.
 * No action or setting has "invite" in its words, so those kinds stay
 * empty under this query; "delete" (Permanently delete plan, Delete
 * account) would fill them at the cost of the rest.
 */

import {
  TASK_WORK_PART,
  TASK_WORK_STATE,
  TASK_WORK_TOOL,
  type TasksTreeAnswer,
} from "@luke/features/planning-view";
import { ACT_KIND } from "@luke/host/acts";
import { FIXTURE_CLOSED_PANEL } from "../tasks/tasks-fixture";
import { ago } from "./clock";
import { codingAgentAnswers } from "./coding-agent";
import { TASK_REPOSITORY, SHOT_ID, shotTasksView } from "./plan-document";
import type { ShotSpec } from "./shot-spec";

/** acme/relay's files, as one recursive listing names them. */
const FILES = [
  "package.json",
  "README.md",
  "AGENTS.md",
  "src/app.ts",
  "src/db/index.ts",
  "src/db/schema/memberships.ts",
  "src/db/schema/users.ts",
  "src/db/schema/workspaces.ts",
  "src/db/migrations/20261013_memberships_state.sql",
  "src/members/invite.ts",
  "src/members/invite.test.ts",
  "src/members/accept-invite.ts",
  "src/members/list.ts",
  "src/members/remove.ts",
  "src/mail/templates/invite-email.tsx",
  "src/mail/client.ts",
  "src/routes/invites.ts",
  "src/routes/members.ts",
  "src/auth/workspace-access.ts",
  "src/billing/seats.ts",
  "web/pages/invites/[token].tsx",
  "web/pages/settings/members.tsx",
];

/** The listing, folders implied by the paths named. */
function tree(): TasksTreeAnswer {
  return {
    folder: {
      path: "",
      repository: TASK_REPOSITORY,
      branch: "main",
      entries: FILES.map((name) => ({ name, kind: "file" as const })),
      truncated: false,
    },
  };
}

/** Luke's last turn on the plan's call: a worker he sent to read how invite links expire. */
function work() {
  return [
    {
      turnId: "shot-turn-1",
      startedAt: ago(9),
      state: TASK_WORK_STATE.DONE,
      earlierOmitted: false,
      asked: [],
      parts: [
        {
          type: TASK_WORK_PART.TOOL,
          id: "shot-worker-1",
          tool: TASK_WORK_TOOL.WORKER,
          name: "worker",
          state: TASK_WORK_STATE.DONE,
          subject: "Check how invite links expire in the accept flow",
          input: "{}",
          output: "Links carry no expiry today; acceptInvite reads the token alone.",
          session: {
            title: "Invite link expiry",
            earlierOmitted: false,
            parts: [
              {
                type: TASK_WORK_PART.TEXT,
                text: "Links carry no expiry today; acceptInvite reads the token alone.",
              },
            ],
          },
        },
        {
          type: TASK_WORK_PART.TEXT,
          text: "Invite links never expire yet, so the plan's 7 days is new work.",
        },
      ],
    },
  ] as const;
}

export function paletteShot(): ShotSpec {
  const listing = tree();
  return {
    tasks: shotTasksView({ extra: { work: work() } }),
    sidePanel: FIXTURE_CLOSED_PANEL,
    answers: {
      ...codingAgentAnswers(),
      [ACT_KIND.TASKS_TREE]: (payload) => (payload.path === "" ? listing : undefined),
    },
    layout: { palette: { query: "invite" } },
  };
}

/** The plan the palette stands over, for a test or a step to name. */
export const PALETTE_TASK_ID = SHOT_ID.TASK;
