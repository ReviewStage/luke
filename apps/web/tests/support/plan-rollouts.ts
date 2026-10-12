import { ROLLOUT_BASE, type Rollout } from "@sidecar/hosted/plan-wire";
import { eq } from "drizzle-orm";
import { plan } from "../../server/db/plan-schema";
import { db } from "../../server/db/query";

/**
 * plan-rollouts.ts -- a stored plan's rollout, as no service path writes one yet.
 *
 * The rollout stands beside a plan's document in a column of its own, and
 * until the notetaker takes rollout notes nothing in production writes it,
 * so a test writes the column itself.
 */

/** Three pull requests: a table on main, then a route and a screen that each need only the table. */
export const INVITATIONS_ROLLOUT: Rollout = [
  {
    title: "Add the invite table",
    scope: "The `invite` table and its migration.",
    base: ROLLOUT_BASE.MAIN,
    acceptance: "A store test writes and reads an invite.",
  },
  { title: "Invite route", scope: "The `invite` route over the table.", base: 1, acceptance: null },
  {
    title: "Invite screen",
    scope: "The form that sends an invite.",
    base: 1,
    acceptance: "The form posts and shows the sent invite.",
  },
];

/** Sets the plan's rollout to `rollout`, as a cut taken by the notetaker would. */
export function cutRollout(planId: string, rollout: Rollout) {
  return db.update(plan).set({ rollout }).where(eq(plan.id, planId));
}
