import { PLAN_FIELD, PLAN_FIELD_HEADING, planTextFieldValue } from "@sidecar/hosted/plan-template";
import {
  PLAN_ACTOR,
  type Plan,
  type PlanAssumption,
  type PlanFields,
  type PlanLastEdit,
} from "@sidecar/hosted/plan-wire";
import { PlusIcon } from "@sidecar/panel";
import { useEffect, useRef, useState } from "react";
import { MarkdownMessage } from "../markdown-message";
import { prefersReducedMotion } from "../use-reduced-motion";
import {
  EDITOR_PLACE,
  EditableUnit,
  type FieldEditing,
  type PlanEditDoor,
  PlanFieldEditor,
  targetLabel,
  useFieldEditing,
} from "./plan-field-editor";
import { type EditTarget, editTargetOfUnit, sameTarget } from "./plan-field-editor-model";
import {
  type ChaseState,
  chaseBehind,
  chaseOpened,
  chaseRetargeted,
  chaseStepped,
  chaseView,
  type UnitView,
} from "./plan-reveal";
import { useMinute } from "./plan-time";
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
 * the scrolled document and never the surface. A plan anyone has written
 * says who last did in one muted line above the document: the developer,
 * Luke (the notetaker), or a coding agent named as its row names it now,
 * whether it was on a call, and how long ago, moved on once a minute. The
 * line opens the plan's History tab, where each earlier version is.
 */

/** The document the chase was last aimed at, the last edit it was, and where its typing stands. */
interface Chase {
  readonly planId: string;
  readonly body: string;
  readonly assumptions: readonly string[];
  readonly lastEditAt: number | undefined;
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

/** The units "ago" is said in, longest first, each with its letter. */
const AGO_UNITS = [
  [86_400_000, "d"],
  [3_600_000, "h"],
  [60_000, "m"],
] as const;

/** How long ago a save was, in the shortest words: "just now", "3m ago", "2h ago", "5d ago". */
export function agoText(at: number, now: number): string {
  const elapsed = Math.max(0, now - at);
  const unit = AGO_UNITS.find(([span]) => elapsed >= span);
  return unit === undefined ? "just now" : `${Math.floor(elapsed / unit[0])}${unit[1]} ago`;
}

/**
 * The plan's last edit: its newest revision, or, from a service before
 * history, the newest save a coding agent made, which was all it could name.
 */
function lastEditOf(plan: Plan): PlanLastEdit | undefined {
  if (plan.lastEdit !== undefined) return plan.lastEdit;
  // The journal is oldest first, so the newest save is its last.
  const journaled = plan.agentEdits?.at(-1);
  if (journaled === undefined) return undefined;
  return { actor: PLAN_ACTOR.AGENT, label: journaled.label, at: journaled.at, duringCall: false };
}

/** Who wrote an edit, in the developer's words; nobody for a revision from before history. */
function editorOf(edit: PlanLastEdit): string | undefined {
  switch (edit.actor) {
    case PLAN_ACTOR.DEVELOPER:
      return "you";
    case PLAN_ACTOR.NOTETAKER:
      return "Luke";
    case PLAN_ACTOR.AGENT:
      return edit.label ?? "a coding agent";
    case PLAN_ACTOR.EARLIER:
      return undefined;
  }
}

/** The line over the document: "Edited by Luke during your call · 2h ago". */
export function editedLine(edit: PlanLastEdit, now: number): string {
  const editor = editorOf(edit);
  const by = editor === undefined ? "Edited" : `Edited by ${editor}`;
  const call = edit.duringCall ? " during your call" : "";
  return `${by}${call} · ${agoText(edit.at, now)}`;
}

/** The line over the document, which opens the plan's history where the window offers it. */
function EditedLine({
  edit,
  onShowHistory,
}: {
  edit: PlanLastEdit;
  onShowHistory: (() => void) | undefined;
}): React.JSX.Element {
  const now = useMinute();
  const line = editedLine(edit, now);
  if (onShowHistory === undefined) return <p className="plan-edit-note">{line}</p>;
  return (
    <p className="plan-edit-note">
      <button
        type="button"
        className="plan-edit-link"
        aria-label={`${line}. Show version history`}
        onClick={onShowHistory}
      >
        {line}
      </button>
    </p>
  );
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

function opened(plan: Plan): Chase {
  const { body, assumptions } = plan.document;
  return {
    planId: plan.id,
    body,
    assumptions: textsOf(assumptions),
    lastEditAt: plan.lastEdit?.at,
    state: chaseOpened(body),
  };
}

/** The chase aimed at the plan as handed over now: a new target for the same plan, a fresh start for another. */
function aimed(chase: Chase, plan: Plan): Chase {
  if (chase.planId !== plan.id) return opened(plan);
  const { body } = plan.document;
  const assumptions = textsOf(plan.document.assumptions);
  const added = { before: chase.assumptions, after: assumptions };
  // The developer's own edit lands at once: they watched it being typed already.
  const lastEditAt = plan.lastEdit?.at;
  const ownEdit = plan.lastEdit?.actor === PLAN_ACTOR.DEVELOPER && lastEditAt !== chase.lastEditAt;
  // Read at the retarget rather than held, since it is the one moment it decides anything.
  const aim = { reduced: ownEdit || prefersReducedMotion() };
  const state = chaseRetargeted(chase.state, body, added, aim);
  return { planId: plan.id, body, assumptions, lastEditAt, state };
}

/**
 * The chase over the plan handed in, stepped once a frame while any unit is
 * behind. A document arriving mid-typing is aimed at from what is shown, so
 * the typing carries on toward it without a jump.
 */
function usePlanChase(plan: Plan, live: boolean): PlanChase {
  const [chase, setChase] = useState(() => opened(plan));
  let current = chase;
  const moved =
    chase.planId !== plan.id ||
    chase.body !== plan.document.body ||
    !sameTexts(chase.assumptions, textsOf(plan.document.assumptions));
  if (moved) {
    current = aimed(chase, plan);
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

/** The door of a document nothing is edited through: every edit answered as unanswered. */
const NO_EDIT: PlanEditDoor = () => Promise.reject(new Error("This plan cannot be edited here."));

/** The text fields the body draws only once they hold something, which the document offers to add while they do not. */
const OPTIONAL_FIELDS = [PLAN_FIELD.ORDER, PLAN_FIELD.DATA_AND_MIGRATION] as const;

/** The heading an editor draws above its inputs: a rule's by its number, since its statement is being typed; the unit's own otherwise. */
function editorHeading(target: EditTarget, words: string, ruleCount: number): string {
  if ("rule" in target && target.rule < ruleCount) return `### Rule ${target.rule + 1}`;
  return words.split("\n", 1)[0] ?? "";
}

/**
 * One unit of the body: drawn as the chase has it, the editor where it is
 * the one the editor opened from, nothing where it is the field an editor
 * holds elsewhere, and the way into its editor where it can be edited.
 */
function BodyUnit({
  view,
  editable,
  editing,
  ruleCount,
}: {
  view: UnitView;
  editable: boolean;
  editing: FieldEditing;
  ruleCount: number;
}): React.JSX.Element | null {
  const drawn = <MarkdownMessage words={view.words} className={unitClass(view)} edit={view.edit} />;
  const target = editable ? editTargetOfUnit(view.words, ruleCount) : undefined;
  if (target === undefined) return drawn;
  const { editor, host } = editing;
  if (editor !== undefined && host === view.id) {
    const heading = editorHeading(editor.target, view.words, ruleCount);
    return (
      <PlanFieldEditor heading={heading} editor={editor} ruleCount={ruleCount} editing={editing} />
    );
  }
  if (editor !== undefined && sameTarget(editor.target, target)) return null;
  const adds = "rule" in target && target.rule >= ruleCount;
  return (
    <EditableUnit
      target={target}
      host={view.id}
      label={targetLabel(target, ruleCount)}
      adds={adds}
      editing={editing}
    >
      {drawn}
    </EditableUnit>
  );
}

/** The sections the body does not draw while they hold nothing, each offered to add. */
function AddSections({
  fields,
  editing,
}: {
  fields: PlanFields;
  editing: FieldEditing;
}): React.JSX.Element | null {
  const absent = OPTIONAL_FIELDS.filter(
    (field) => planTextFieldValue(fields, field) === null && editing.editor?.target.field !== field,
  );
  if (absent.length === 0) return null;
  return (
    <div className="plan-add-sections">
      {absent.map((field) => (
        <button
          key={field}
          type="button"
          className="toolbar-button"
          onClick={() => editing.open({ field }, EDITOR_PLACE.END)}
        >
          <PlusIcon />
          {PLAN_FIELD_HEADING[field]}
        </button>
      ))}
    </div>
  );
}

/**
 * The assumptions' section, standing even while the list is empty: the
 * list, the way into its editor where it can be edited, or the editor.
 */
function PlanAssumptions({
  assumptions,
  fresh,
  editable,
  editing,
}: {
  assumptions: readonly PlanAssumption[];
  fresh: ReadonlySet<number>;
  editable: boolean;
  editing: FieldEditing;
}): React.JSX.Element {
  const list =
    assumptions.length === 0 ? (
      <p className="plan-assumptions-none">{NO_ASSUMPTIONS_LINE}</p>
    ) : (
      <ul>
        {assumptions.map((assumption, index) => (
          // An assumption has no id of its own: the list is replaced whole on every save.
          // oxlint-disable-next-line react/no-array-index-key -- the saved list's order is its identity.
          <AssumptionRow key={index} assumption={assumption} fresh={fresh.has(index)} />
        ))}
      </ul>
    );
  const target = { field: PLAN_FIELD.ASSUMPTIONS } as const;
  const { editor, host } = editing;
  const body =
    editor !== undefined && host === EDITOR_PLACE.ASSUMPTIONS ? (
      <PlanFieldEditor heading={undefined} editor={editor} ruleCount={0} editing={editing} />
    ) : editable ? (
      <EditableUnit
        target={target}
        host={EDITOR_PLACE.ASSUMPTIONS}
        label={PLAN_FIELD_HEADING.assumptions}
        adds={false}
        editing={editing}
      >
        {list}
      </EditableUnit>
    ) : (
      list
    );
  return (
    <section className="plan-assumptions" aria-label="Assumptions">
      <h2 className="plan-assumptions-heading">Assumptions</h2>
      {body}
    </section>
  );
}

/**
 * The plan's body and its assumptions, the assumptions' section standing even
 * while the list is empty. `live` is the plan's call in progress, which keeps
 * the caret waiting where the typing last stopped; `onShowHistory` opens the
 * plan's History tab from the "Edited by" line. With `onEdit`, and fields
 * from a service that sends them, each field opens in an editor in place.
 */
export function PlanBody({
  plan,
  live,
  onShowHistory,
  onEdit,
}: {
  plan: Plan;
  live: boolean;
  onShowHistory?: () => void;
  onEdit?: PlanEditDoor;
}): React.JSX.Element {
  const { views, behind, freshAssumptions, jumps } = usePlanChase(plan, live);
  const { fields } = plan;
  const content =
    onEdit === undefined || fields === undefined
      ? undefined
      : { fields, assumptions: plan.document.assumptions };
  const editable = content !== undefined;
  const editing = useFieldEditing(plan.id, content, onEdit ?? NO_EDIT);
  const ruleCount = fields?.rules?.length ?? 0;
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
  const edited = lastEditOf(plan);
  return (
    <div ref={scroller} className="plan-document-scroll">
      {edited === undefined ? null : <EditedLine edit={edited} onShowHistory={onShowHistory} />}
      <div className="plan-body">
        {views.map((view) => (
          <BodyUnit
            key={view.id}
            view={view}
            editable={editable}
            editing={editing}
            ruleCount={ruleCount}
          />
        ))}
        {editing.editor !== undefined && editing.host === EDITOR_PLACE.END ? (
          <PlanFieldEditor
            heading={`## ${targetLabel(editing.editor.target, ruleCount)}`}
            editor={editing.editor}
            ruleCount={ruleCount}
            editing={editing}
          />
        ) : null}
        {content === undefined ? null : <AddSections fields={content.fields} editing={editing} />}
      </div>
      <PlanAssumptions
        assumptions={assumptions}
        fresh={freshAssumptions}
        editable={editable}
        editing={editing}
      />
    </div>
  );
}
