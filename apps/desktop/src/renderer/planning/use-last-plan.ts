import type { PlanSummary } from "@sidecar/hosted/plan-wire";
import { PLANNING_READ, type PlanningView } from "@sidecar/hosted/planning-view";
import { Schema } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";
import { readKept, writeKept } from "../desktop/folded-groups";

/**
 * use-last-plan.ts -- the plan each account last had open, kept across launches, and opened again at the next launch where it still stands.
 *
 * A launch opens the window on the plan the account had open when it quit,
 * once the plan list says it is still one of the account's and not
 * archived; its tabs, the one shown, and its side panel come back with it,
 * because those are kept by plan already (`use-main-tabs.ts`,
 * `use-side-panel.ts`). A plan deleted or archived since, or none open at
 * quit, leaves the window on the home page. The plan names its workspace,
 * so opening it lists that workspace, as opening a plan from the palette
 * does, and a plan of a workspace the account has left is not listed, so it
 * is not opened.
 *
 * The plan is kept by account, so another account signed in on this Mac
 * never opens it; it is kept as the host opens it, and let go when the host
 * closes it, as leaving it for the home page does. Until the list is read,
 * the window is restoring and draws no home page, so a plan about to open
 * does not flash the home page first; once the plan is asked for it stays
 * restoring until the host has it open, or the ask is taken back. A
 * fixture run keeps nothing and opens nothing, as it draws plans of its
 * own.
 */

/** Where the plans are kept in the renderer's storage. */
const STORAGE_KEY = "luke.lastPlan";

/** Each account's last open plan, by the account's email. */
const storedPlans = Schema.fromJsonString(Schema.Record(Schema.String, Schema.String));

type KeptPlans = typeof storedPlans.Type;

const NONE_KEPT: KeptPlans = {};

/** The kept plans with the account's set to `planId`, or let go with none. */
function withKept(kept: KeptPlans, account: string, planId: string | undefined): KeptPlans {
  if (kept[account] === planId) return kept;
  if (planId !== undefined) return { ...kept, [account]: planId };
  const { [account]: _gone, ...rest } = kept;
  return rest;
}

/** Whether the plan list has answered, either way: what the reopen waits for. */
function listSettled(status: PlanningView["listStatus"]): boolean {
  return status !== PLANNING_READ.IDLE && status !== PLANNING_READ.READING;
}

/**
 * Keeps the plan open for `account`, the signed-in account's email or none,
 * and opens the kept one through `select` once `plans` are read. Answers
 * whether the window is still restoring it. `boundFor` is the plan the tab
 * is bound for, the one asked for before the host answers.
 */
export function useLastPlan(input: {
  staged: boolean;
  account: string | undefined;
  plans: readonly PlanSummary[];
  listStatus: PlanningView["listStatus"];
  openPlanId: string | undefined;
  boundFor: string | undefined;
  select: (planId: string) => void;
}): boolean {
  const { staged, account, plans, listStatus, openPlanId, boundFor, select } = input;
  const [kept, setKept] = useState(() => readKept(STORAGE_KEY, storedPlans, NONE_KEPT));
  // The account the launch's reopen was decided for, and the plan it asked for.
  const [decided, setDecided] = useState<{ account: string; asked?: string } | undefined>(
    undefined,
  );
  const wasOpen = useRef<string | undefined>(undefined);
  const keep = useCallback(
    (next: (held: KeptPlans) => KeptPlans) =>
      setKept((held) => {
        const changed = next(held);
        if (changed !== held) writeKept(STORAGE_KEY, storedPlans, changed);
        return changed;
      }),
    [],
  );

  // The plan the host opens is kept, and let go once it closes. Note that
  // only a close seen in this run lets it go, because nothing is open at a
  // launch until the reopen opens it.
  useEffect(() => {
    if (staged || account === undefined) return;
    const was = wasOpen.current;
    wasOpen.current = openPlanId;
    if (openPlanId !== undefined) keep((held) => withKept(held, account, openPlanId));
    else if (was !== undefined) keep((held) => withKept(held, account, undefined));
  }, [staged, account, openPlanId, keep]);

  // Once per account signed in, as soon as the list answers: the kept plan
  // where it is listed and not archived, else nothing, and a kept plan the
  // list read does not offer is let go. A window reloaded over a plan the
  // host still holds has nothing to reopen.
  const keptPlan = account === undefined ? undefined : kept[account];
  useEffect(() => {
    if (staged || account === undefined || decided?.account === account) return;
    if (openPlanId !== undefined) {
      setDecided({ account });
      return;
    }
    if (!listSettled(listStatus)) return;
    const plan = plans.find((each) => each.id === keptPlan && each.archivedAt === undefined);
    if (plan === undefined) {
      if (keptPlan !== undefined && listStatus === PLANNING_READ.READY) {
        keep((held) => withKept(held, account, undefined));
      }
      setDecided({ account });
      return;
    }
    setDecided({ account, asked: plan.id });
    select(plan.id);
  }, [staged, account, decided, openPlanId, listStatus, plans, keptPlan, select, keep]);

  if (staged || account === undefined || openPlanId !== undefined) return false;
  if (decided?.account !== account) return keptPlan !== undefined;
  return decided.asked !== undefined && boundFor === decided.asked;
}
