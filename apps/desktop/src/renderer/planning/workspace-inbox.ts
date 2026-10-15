import type { Plan } from "@luke/features/plan-wire";

/**
 * workspace-inbox.ts -- what the Inbox holds, by workspace: the listed workspace's share of it, and how many items wait in each.
 *
 * Main reads what waits across every plan the account can reach, and the
 * window lists one workspace at a time, so everything the window lists of
 * the Inbox, its rows, the sidebar's count, and Home's waiting list, is the
 * listed workspace's share (`docs/proposals/workspace-clarity.md`, decision
 * 11), while the switcher counts what waits in each of the others. A plan is
 * placed by the workspace the account's plan list says it is in, so an item
 * of a plan not yet listed is in no workspace's share until it is.
 */

/** The entries of the plans in `workspaceId`, or every entry while no workspace is listed. */
export function inWorkspace<Entry extends { readonly planId: string }>(
  entries: readonly Entry[],
  plans: readonly Pick<Plan, "id" | "workspaceId">[],
  workspaceId: string | undefined,
): readonly Entry[] {
  if (workspaceId === undefined) return entries;
  const listed = new Set(
    plans.filter((plan) => plan.workspaceId === workspaceId).map((plan) => plan.id),
  );
  return entries.filter((entry) => listed.has(entry.planId));
}

/** How many items wait in each workspace, by its id; a workspace where none wait is absent. */
export function waitingByWorkspace(
  inbox: readonly { readonly planId: string; readonly items: readonly unknown[] }[],
  plans: readonly Pick<Plan, "id" | "workspaceId">[],
): ReadonlyMap<string, number> {
  const workspaceOf = new Map(plans.map((plan) => [plan.id, plan.workspaceId]));
  const counts = new Map<string, number>();
  for (const plan of inbox) {
    const workspaceId = workspaceOf.get(plan.planId);
    if (workspaceId === undefined || plan.items.length === 0) continue;
    counts.set(workspaceId, (counts.get(workspaceId) ?? 0) + plan.items.length);
  }
  return counts;
}
