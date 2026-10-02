import type { Plan, PlanAssumption } from "@sidecar/hosted/plan-wire";
import { useEffect, useRef, useState } from "react";
import { MarkdownMessage } from "../markdown-message";
import { prefersReducedMotion } from "../use-reduced-motion";
import {
  type ChaseState,
  chaseBehind,
  chaseOpened,
  chaseRetargeted,
  chaseStepped,
  chaseView,
  type UnitView,
} from "./plan-reveal";
import { NO_ASSUMPTIONS_LINE } from "./planning-model";

/**
 * plan-body.tsx -- the open plan's document as it scrolls between the header and the microphone row, typing in each newer document as it arrives.
 *
 * Every document the host hands over for the open plan becomes the chase's
 * target, whether a saved plan or a draft still being written, so a stream of
 * drafts is worked in by one continuous hand rather than restarting on each.
 * The view follows the caret, bringing a jump to the middle, unless the
 * developer has scrolled the document themselves, and lights each unit and new assumption as it settles. Opening
 * a plan draws it whole, and reduced motion draws each document at once. The
 * fixed template always runs past the panel's ceiling, so the typing grows
 * the scrolled document and never the surface.
 */

/** The document the chase was last aimed at, the save and call it was aimed under, and where its typing stands. */
interface Chase {
  readonly planId: string;
  readonly body: string;
  readonly assumptions: readonly string[];
  readonly updatedAt: number;
  readonly live: boolean;
  readonly state: ChaseState;
}

/** What the document draws from the chase this frame. */
interface PlanChase {
  readonly views: readonly UnitView[];
  readonly behind: boolean;
  readonly freshAssumptions: ReadonlySet<number>;
  /** How many times the caret has jumped, so the view can bring a jump to the middle. */
  readonly jumps: number;
}

/** The class of a unit or assumption lit as it settles. */
const FRESH_CLASS = "plan-fresh";

/** The class of the unit the caret is typing in, whose heading wears the writing mark. */
const WRITING_CLASS = "plan-writing";

/** The class of the unit the caret waits at the end of, where it blinks. */
const RESTING_CLASS = "plan-caret-resting";

/** The presses that say the developer is reading somewhere of their own, which the caret stops following. */
const SCROLL_INTENT_EVENTS = ["wheel", "pointerdown", "keydown"] as const;

function textsOf(assumptions: readonly PlanAssumption[]): readonly string[] {
  return assumptions.map((assumption) => assumption.text);
}

function sameTexts(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((text, index) => text === right[index]);
}

function opened(plan: Plan, live: boolean): Chase {
  const { body, assumptions } = plan.document;
  const { id: planId, updatedAt } = plan;
  return {
    planId,
    body,
    assumptions: textsOf(assumptions),
    updatedAt,
    live,
    state: chaseOpened(body),
  };
}

/**
 * The chase aimed at the plan as handed over now: a new target for the same
 * plan, a fresh start for another. A save, which moves the plan's
 * `updatedAt`, or the call ending settles every unit, since nothing is
 * streaming any more.
 */
function aimed(chase: Chase, plan: Plan, live: boolean): Chase {
  if (chase.planId !== plan.id) return opened(plan, live);
  const { body } = plan.document;
  const assumptions = textsOf(plan.document.assumptions);
  const added = { before: chase.assumptions, after: assumptions };
  const settle = plan.updatedAt !== chase.updatedAt || !live;
  // Read at the retarget rather than held, since it is the one moment it decides anything.
  const aim = { reduced: prefersReducedMotion(), settle };
  const state = chaseRetargeted(chase.state, body, added, aim);
  return { planId: plan.id, body, assumptions, updatedAt: plan.updatedAt, live, state };
}

/**
 * The chase over the plan handed in, stepped once a frame while any unit is
 * behind. A document arriving mid-typing is aimed at from what is shown, so
 * the typing carries on toward it without a jump.
 */
function usePlanChase(plan: Plan, live: boolean): PlanChase {
  const [chase, setChase] = useState(() => opened(plan, live));
  let current = chase;
  const moved =
    chase.planId !== plan.id ||
    chase.body !== plan.document.body ||
    chase.updatedAt !== plan.updatedAt ||
    chase.live !== live ||
    !sameTexts(chase.assumptions, textsOf(plan.document.assumptions));
  if (moved) {
    current = aimed(chase, plan, live);
    setChase(current);
  }
  const behind = chaseBehind(current.state);

  useEffect(() => {
    if (!behind) return;
    let last = performance.now();
    let frame = requestAnimationFrame(function step(now: number) {
      const elapsed = now - last;
      last = now;
      setChase((held) => ({ ...held, state: chaseStepped(held.state, elapsed) }));
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [behind]);

  return {
    views: chaseView(current.state, live),
    behind,
    freshAssumptions: current.state.freshAssumptions,
    jumps: current.state.jumps,
  };
}

function unitClass(view: UnitView): string {
  if (view.writing) return `plan-unit ${WRITING_CLASS}`;
  if (view.resting) return `plan-unit ${RESTING_CLASS}${view.fresh ? ` ${FRESH_CLASS}` : ""}`;
  return view.fresh ? `plan-unit ${FRESH_CLASS}` : "plan-unit";
}

/** One assumption, its text as stored. */
function AssumptionRow({
  assumption,
  fresh,
}: {
  assumption: PlanAssumption;
  fresh: boolean;
}): React.JSX.Element {
  return (
    <li className={fresh ? `plan-assumption ${FRESH_CLASS}` : "plan-assumption"}>
      {assumption.text}
    </li>
  );
}

/**
 * The plan's body and its assumptions, the assumptions' section standing even
 * while the list is empty. `live` is the plan's call in progress, which keeps
 * the caret waiting where the typing last stopped.
 */
export function PlanBody({ plan, live }: { plan: Plan; live: boolean }): React.JSX.Element {
  const { views, behind, freshAssumptions, jumps } = usePlanChase(plan, live);
  const scroller = useRef<HTMLDivElement>(null);
  /** Whether the developer has scrolled since the typing last began, which stops the caret being followed. */
  const scrolledAway = useRef(false);
  /** The caret's jumps when the view last followed it. */
  const followedJumps = useRef(jumps);

  useEffect(() => {
    const element = scroller.current;
    if (element === null) return;
    const intent = () => {
      scrolledAway.current = true;
    };
    for (const kind of SCROLL_INTENT_EVENTS) element.addEventListener(kind, intent);
    return () => {
      for (const kind of SCROLL_INTENT_EVENTS) element.removeEventListener(kind, intent);
    };
  }, []);

  // A pause in the typing hands the view back: the next burst is followed again.
  useEffect(() => {
    if (!behind) scrolledAway.current = false;
  }, [behind]);

  // Note that the caret is scrolled to on every frame it moves, because
  // "nearest" is nothing while it is already in view. A jump is brought to
  // the middle instead, so the developer sees where the caret went and what
  // stands around it.
  useEffect(() => {
    const jumped = jumps !== followedJumps.current;
    followedJumps.current = jumps;
    if (!behind || scrolledAway.current) return;
    const block = jumped ? "center" : "nearest";
    scroller.current?.querySelector(".markdown-caret")?.scrollIntoView({ block });
  });

  const { assumptions } = plan.document;
  return (
    <div ref={scroller} className="plan-document-scroll">
      <div className="plan-body">
        {views.map((view, index) => (
          <MarkdownMessage
            // The template's order is fixed, so a unit's position is its identity from one document to the next.
            // oxlint-disable-next-line react/no-array-index-key -- the template's order is the unit's identity.
            key={index}
            words={view.words}
            className={unitClass(view)}
            edit={view.edit}
          />
        ))}
      </div>
      <section className="plan-assumptions" aria-label="Assumptions">
        <h2 className="plan-assumptions-heading">Assumptions</h2>
        {assumptions.length === 0 ? (
          <p className="plan-assumptions-none">{NO_ASSUMPTIONS_LINE}</p>
        ) : (
          <ul>
            {assumptions.map((assumption, index) => (
              // An assumption has no id of its own: the list is replaced whole on every save.
              // oxlint-disable-next-line react/no-array-index-key -- the saved list's order is its identity.
              <AssumptionRow
                key={index}
                assumption={assumption}
                fresh={freshAssumptions.has(index)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
