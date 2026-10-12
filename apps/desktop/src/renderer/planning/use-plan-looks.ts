import { useAtom } from "@effect/atom-react";
import { PLAN_ACTOR, type Plan, type PlanField } from "@sidecar/hosted/plan-wire";
import { Duration, Effect, Option, Schema } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useState } from "react";
import { rendererRuntime } from "../renderer-runtime";

/**
 * use-plan-looks.ts -- which sections of the open plan changed since the developer last looked at it on this Mac.
 *
 * A look is the plan held open for a few seconds: from then on, every save
 * the developer has the plan open for is one they watched land, so the
 * newest save the plan names is kept as what they last saw. Opening the plan
 * again reads that mark, and each field a save by anyone but the developer
 * changed after it is a section changed since they last looked, held for the
 * visit until they dismiss it or leave. A save that lands while the plan is
 * open is typed in before their eyes, the notetaker's on a call above all,
 * so it never joins the visit's changes. A plan never looked at on this Mac
 * has no mark and nothing changed: every section would be new.
 *
 * The mark is a save's instant as the service stamped it, never this Mac's
 * clock, so a clock that disagrees with the service's moves nothing. It is
 * this window's to remember, kept in the renderer's own storage by plan id
 * and holding nothing of the plan but that instant; a deleted plan's entry
 * is left behind, a few bytes nothing reads again.
 */

/** How long the plan is open before the developer has looked at it. */
export const PLAN_LOOK = Duration.seconds(3);

/** Where the plans' marks are kept in the renderer's storage. */
const STORAGE_KEY = "luke.planLooks";

/** The newest save each plan had when the developer last looked at it, by plan id. */
const storedLooks = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Number));

type Looks = typeof storedLooks.Type;

const decodeStored = Schema.decodeUnknownOption(storedLooks);
const encodeStored = Schema.encodeSync(storedLooks);

/** One stay on a plan, as the look's wait knows it: a fresh object each visit, so a wait from an earlier one never counts. */
interface VisitToken {
  readonly planId: string | undefined;
}

/** The look's wait, as an atom whose work is the wait; a new visit starts it over. */
const lookAtom = rendererRuntime.fn((visit: VisitToken) =>
  Effect.as(Effect.sleep(PLAN_LOOK), visit),
);

/** One stay on a plan: the sections changed since the last look as it opened, and its token for the look's wait. */
interface Visit {
  readonly planId: string | undefined;
  readonly token: VisitToken;
  readonly changed: ReadonlySet<PlanField>;
}

/** The open plan's sections changed since the last look, and the dismissal that clears them. */
export interface PlanLooks {
  readonly changed: ReadonlySet<PlanField>;
  readonly dismiss: () => void;
}

const NOTHING_CHANGED: ReadonlySet<PlanField> = new Set();

/** The looks of a document no plan's visit stands behind: nothing changed, and nothing to dismiss. */
export const NO_LOOKS: PlanLooks = { changed: NOTHING_CHANGED, dismiss: () => undefined };

/** The kept marks, or none where none were kept, they no longer read, or storage refuses the read. */
function readLooks(): Looks {
  try {
    return Option.getOrElse(decodeStored(window.localStorage.getItem(STORAGE_KEY)), () => ({}));
  } catch {
    return {};
  }
}

/** Keeps the plan's mark where it moves it on; a write that fails costs only a section lit again. */
function keepLook(planId: string, seenAt: number): void {
  const looks = readLooks();
  if ((looks[planId] ?? Number.NEGATIVE_INFINITY) >= seenAt) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, encodeStored({ ...looks, [planId]: seenAt }));
  } catch {
    // The sections changed before this look stay lit on the next visit.
  }
}

/** The instant of the newest save the plan names, or none for a plan nobody has written. */
function newestSaveOf(plan: Plan): number | undefined {
  const instants = [
    ...(plan.lastEdit === undefined ? [] : [plan.lastEdit.at]),
    ...(plan.fieldEdits ?? []).map((edit) => edit.at),
  ];
  return instants.length === 0 ? undefined : Math.max(...instants);
}

/** A visit to the plan as it opens: each field someone else saved after the last look; none while no plan is drawn. */
function visited(plan: Plan | undefined): Visit {
  if (plan === undefined)
    return { planId: undefined, token: { planId: undefined }, changed: NOTHING_CHANGED };
  const mark = readLooks()[plan.id];
  const changed =
    mark === undefined
      ? NOTHING_CHANGED
      : new Set(
          (plan.fieldEdits ?? [])
            .filter((edit) => edit.actor !== PLAN_ACTOR.DEVELOPER && edit.at > mark)
            .map((edit) => edit.field),
        );
  return { planId: plan.id, token: { planId: plan.id }, changed };
}

/**
 * The drawn plan's sections changed since the developer last looked at it,
 * and the mark moved on once they have: after `PLAN_LOOK` open, and again
 * with every save while it stays open. Note that it is held by the window's
 * shell rather than the plan's page, because the plan's version history
 * standing in the page's place is still a stay on the plan.
 */
export function usePlanLooks(plan: Plan | undefined): PlanLooks {
  const [visit, setVisit] = useState(() => visited(plan));
  const [look, restartLook] = useAtom(lookAtom);
  let current = visit;
  if (visit.planId !== plan?.id) {
    current = visited(plan);
    setVisit(current);
  }
  const { token } = current;
  const looked = AsyncResult.isSuccess(look) && !look.waiting && look.value === token;
  const planId = plan?.id;
  const newest = plan === undefined ? undefined : newestSaveOf(plan);

  useEffect(() => restartLook(token), [token, restartLook]);

  useEffect(() => {
    if (looked && planId !== undefined && newest !== undefined) keepLook(planId, newest);
  }, [looked, planId, newest]);

  return {
    changed: current.changed,
    dismiss: () => {
      setVisit((held) => (held.planId === planId ? { ...held, changed: NOTHING_CHANGED } : held));
      if (planId !== undefined && newest !== undefined) keepLook(planId, newest);
    },
  };
}
