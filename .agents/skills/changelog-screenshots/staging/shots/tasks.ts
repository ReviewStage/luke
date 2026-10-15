/**
 * plans.ts -- shot K, "Pin, archive, and group plans": the sidebar rich with plans grouped by repository, a pinned plan and a pinned repository, the pinned plan's hover card open.
 *
 * Throwaway (`README.md`). "Teammate invitations" is pinned, its hover card
 * standing over the main column with its repository, its two coding agents,
 * and their pull requests; acme/ledger is pinned, so its group stands
 * first; acme/relay and acme/web follow, each row updated minutes, hours, or
 * days ago; one plan waits folded under Archived. The plan open is another,
 * "Usage-based billing" on acme/ledger, with a short document of its own and
 * no agents, so the main column is not the document the other shots show.
 * The owners' pictures are drawn from `owner-pictures.ts`, not fetched.
 */

import { PLAN_ACTOR, type Plan } from "@luke/features/plan-wire";
import { FIXTURE_CLOSED_PANEL } from "../tasks/tasks-fixture";
import { ago, daysAgo, hoursAgo } from "./clock";
import { codingAgentAnswers } from "./coding-agent";
import {
  documentText,
  SHOT_ID,
  shotArchivedTask,
  shotOtherTasks,
  shotTasksView,
  shotTaskSummary,
} from "./plan-document";
import type { ShotSpec } from "./shot-spec";

/** The plan open: billing by usage on acme/ledger, its call a few minutes behind it. */
function billingPlan(): Plan {
  const row = shotOtherTasks().find((task) => task.id === SHOT_ID.BILLING);
  return {
    id: SHOT_ID.BILLING,
    name: row?.name ?? "Usage-based billing",
    createdAt: row?.createdAt ?? daysAgo(4),
    updatedAt: row?.updatedAt ?? ago(26),
    repository: "acme/ledger",
    document: {
      body: `${documentText({
        Context:
          "Every workspace pays a flat $12 a seat. Teams that run thousands of webhook " +
          "deliveries a day pay the same as teams that run ten, and the largest three " +
          "accounts cost more to serve than they pay.",
        Goal:
          "- A workspace is billed per seat plus per 1,000 deliveries past its plan's allowance.\n" +
          "- An admin sees this month's usage and the projected invoice in **Settings › Billing**.\n" +
          "- Nobody's bill changes without 30 days' notice.",
        Approach:
          "- Count deliveries into a `usage_daily` rollup (`src/usage/rollup.ts`, new), one row " +
          "per workspace per day, from the delivery log the worker already writes.\n" +
          "- Report the month's total to Stripe as a metered price on the existing subscription " +
          "(`src/billing/stripe.ts`), so invoices stay Stripe's.\n" +
          "- The projected invoice reads the rollup, never the raw log.",
      })}\n`,
      assumptions: [],
    },
    lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: row?.updatedAt ?? ago(26), duringCall: true },
  };
}

export function tasksShot(): ShotSpec {
  return {
    tasks: shotTasksView({
      task: billingPlan(),
      tasks: [shotTaskSummary({ pinnedAt: hoursAgo(20) }), ...shotOtherTasks(), shotArchivedTask()],
      extra: { repositoryPins: [{ repository: "acme/ledger", pinnedAt: daysAgo(3) }] },
    }),
    sidePanel: FIXTURE_CLOSED_PANEL,
    answers: codingAgentAnswers(),
    layout: { hoverTaskId: SHOT_ID.TASK },
  };
}
