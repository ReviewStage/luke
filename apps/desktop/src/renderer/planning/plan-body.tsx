import { PLAN_FIELD_HEADING, planTextFieldValue } from "@sidecar/hosted/plan-template";
import {
  PLAN_ACTOR,
  PLAN_FIELD,
  type Plan,
  type PlanAssumption,
  type PlanField,
  type PlanFieldEdit,
  type PlanFields,
  type PlanLastEdit,
} from "@sidecar/hosted/plan-wire";
import { PlusIcon } from "@sidecar/panel";
import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../use-reduced-motion";
import {
  EDITOR_PLACE,
  EditableUnit,
  type EditorHost,
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
import { PlanUnitWords } from "./plan-rule";
import { useMinute } from "./plan-time";
import { NO_ASSUMPTIONS_LINE } from "./planning-model";
import { NO_LOOKS, type PlanLooks } from "./use-plan-looks";

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
 * line opens the plan's version history, where each earlier version is. Each
 * section says the same of the save that last changed it, quietly, while the
 * pointer or the keyboard is on it. The sections changed since the developer
 * last looked at the plan on this Mac wear a still tint, counted under that
 * line, until they dismiss them or leave the plan (`use-plan-looks.ts`).
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

/** The line over the document, and each section's: "Edited by Luke during your call · 2h ago". */
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

/** How many sections changed since the last look, as the line under "Edited by" counts them. */
function changedLine(count: number): string {
  return `Changed since you last looked · ${count} ${count === 1 ? "section" : "sections"}`;
}

/** The line under "Edited by" while sections changed since the last look stand lit, with their dismissal. */
function ChangedLine({ looks }: { looks: PlanLooks }): React.JSX.Element | null {
  if (looks.changed.size === 0) return null;
  return (
    <p className="plan-changed-note">
      <span>{changedLine(looks.changed.size)}</span>
      <span aria-hidden="true">·</span>
      <button type="button" className="link-button" onClick={looks.dismiss}>
        Dismiss
      </button>
    </p>
  );
}

/** What each unit says of its field: the save that last changed each, which changed since the last look, and the minute it counts from. */
interface FieldMarks {
  readonly edits: ReadonlyMap<PlanField, PlanFieldEdit>;
  readonly changed: ReadonlySet<PlanField>;
  readonly now: number;
}

/** The section's quiet line: who last changed it, and when, shown while the pointer or the keyboard is on it; none where no save has. */
function bylineOf(marks: FieldMarks, field: PlanField): React.JSX.Element | null {
  const edit = marks.edits.get(field);
  if (edit === undefined) return null;
  return <span className="plan-unit-byline">{editedLine(edit, marks.now)}</span>;
}

/** The class of a unit or assumption lit as it settles. */
const FRESH_CLASS = "plan-fresh";

/** The class of the unit the caret is typing in, whose heading wears the writing mark. */
const WRITING_CLASS = "plan-writing";

/** The class of the unit the caret waits at the end of, where it blinks. */
const RESTING_CLASS = "plan-caret-resting";

/** The class of a section changed since the developer last looked, tinted until they dismiss it. */
const CHANGED_CLASS = "plan-changed";

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
  // The developer's own edit lands at once and unlit: they watched it being typed already.
  const lastEditAt = plan.lastEdit?.at;
  const ownEdit = plan.lastEdit?.actor === PLAN_ACTOR.DEVELOPER && lastEditAt !== chase.lastEditAt;
  // Read at the retarget rather than held, since it is the one moment it decides anything.
  const aim = { reduced: ownEdit || prefersReducedMotion(), lit: !ownEdit };
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

function unitClass(view: UnitView, changed: boolean): string {
  const lit = changed ? ` ${CHANGED_CLASS}` : "";
  if (view.writing) return `plan-unit ${WRITING_CLASS}${lit}`;
  if (view.resting) return `plan-unit ${RESTING_CLASS}${view.fresh ? ` ${FRESH_CLASS}` : ""}${lit}`;
  return view.fresh ? `plan-unit ${FRESH_CLASS}${lit}` : `plan-unit${lit}`;
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
 * Whether a unit is a rule only a notetaker's draft holds so far: drawn, but
 * not yet among the saved rules an editor opens on, so it is edited once it
 * is saved rather than opened empty.
 */
function draftedOnly(target: EditTarget, words: string, ruleCount: number): boolean {
  return "rule" in target && target.rule >= ruleCount && !words.startsWith("## ");
}

/** SPIKE: whether a unit is drawn as a block the developer can select and edit. */
function editableView(view: UnitView, ruleCount: number): boolean {
  const target = editTargetOfUnit(view.words, ruleCount);
  return target !== undefined && !draftedOnly(target, view.words, ruleCount);
}

/**
 * One unit of the body: drawn as the chase has it, tinted where its field
 * changed since the last look, the editor where it is the one the editor
 * opened from, nothing where it is the field an editor holds elsewhere, and
 * the way into its editor where it can be edited. A unit that opens its
 * field, every one but a rule under the rules' heading, carries the field's
 * byline.
 */
function BodyUnit({
  view,
  editable,
  editing,
  ruleCount,
  marks,
  entry,
}: {
  view: UnitView;
  editable: boolean;
  editing: FieldEditing;
  ruleCount: number;
  marks: FieldMarks;
  /** SPIKE: the block where Tab enters the document. */
  entry: EditorHost | undefined;
}): React.JSX.Element | null {
  const target = editTargetOfUnit(view.words, ruleCount);
  const changed = target !== undefined && marks.changed.has(target.field);
  const drawn = (
    <PlanUnitWords words={view.words} className={unitClass(view, changed)} edit={view.edit} />
  );
  if (target === undefined) return drawn;
  // A rule shares the rules' line, which stands on their heading.
  const opensField = !("rule" in target) || view.words.startsWith("## ");
  const byline = opensField ? bylineOf(marks, target.field) : null;
  if (!editable || draftedOnly(target, view.words, ruleCount)) {
    return byline === null ? (
      drawn
    ) : (
      <div className="plan-unit-attributed">
        {drawn}
        {byline}
      </div>
    );
  }
  const { editor, host } = editing;
  if (editor !== undefined && host === view.id) {
    const heading = editorHeading(editor.target, view.words, ruleCount);
    return (
      <PlanFieldEditor
        heading={heading}
        editor={editor}
        ruleCount={ruleCount}
        editing={editing}
        drawn={drawn}
      />
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
      entry={entry === view.id}
      editing={editing}
    >
      {drawn}
      {byline}
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
 * list, the way into its editor where it can be edited, or the editor, under
 * the section's byline and tinted, as a unit is, where it changed since the
 * last look.
 */
function PlanAssumptions({
  assumptions,
  fresh,
  editable,
  editing,
  marks,
  entry,
}: {
  assumptions: readonly PlanAssumption[];
  fresh: ReadonlySet<number>;
  editable: boolean;
  editing: FieldEditing;
  marks: FieldMarks;
  /** SPIKE: the block where Tab enters the document. */
  entry: EditorHost | undefined;
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
      <PlanFieldEditor
        heading={undefined}
        editor={editor}
        ruleCount={0}
        editing={editing}
        drawn={list}
      />
    ) : editable ? (
      <EditableUnit
        target={target}
        host={EDITOR_PLACE.ASSUMPTIONS}
        label={PLAN_FIELD_HEADING.assumptions}
        adds={false}
        entry={entry === EDITOR_PLACE.ASSUMPTIONS}
        editing={editing}
      >
        {list}
      </EditableUnit>
    ) : (
      list
    );
  const changed = marks.changed.has(PLAN_FIELD.ASSUMPTIONS);
  return (
    <section
      className={changed ? `plan-assumptions ${CHANGED_CLASS}` : "plan-assumptions"}
      aria-label="Assumptions"
    >
      <h2 className="plan-assumptions-heading">Assumptions</h2>
      {bylineOf(marks, PLAN_FIELD.ASSUMPTIONS)}
      {body}
    </section>
  );
}

/**
 * The plan's body and its assumptions, the assumptions' section standing even
 * while the list is empty. `live` is the plan's call in progress, which keeps
 * the caret waiting where the typing last stopped; `onShowHistory` opens the
 * plan's version history from the "Edited by" line. With `onEdit`, and fields
 * from a service that sends them, each field opens in an editor in place.
 * `looks` are the sections changed since the developer last looked, which
 * the plan's region keeps (`use-plan-looks.ts`); without them none are.
 */
export function PlanBody({
  plan,
  live,
  onShowHistory,
  onEdit,
  looks = NO_LOOKS,
}: {
  plan: Plan;
  live: boolean;
  onShowHistory?: () => void;
  onEdit?: PlanEditDoor;
  looks?: PlanLooks;
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
  const now = useMinute();
  const marks: FieldMarks = {
    edits: new Map(plan.fieldEdits?.map((edit) => [edit.field, edit])),
    changed: looks.changed,
    now,
  };
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

  // SPIKE: with nothing focused, the arrows select a block, the first in view
  // going down and the last going up, rather than scroll the page. Note that
  // focus anywhere else keeps its own arrows, so this never takes them from a
  // control.
  useEffect(() => {
    if (!editable) return;
    const select = (event: KeyboardEvent) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const element = scroller.current;
      if (element === null || document.activeElement !== document.body) return;
      const shown = element.getBoundingClientRect();
      const blocks = [...element.querySelectorAll<HTMLElement>(".plan-unit-editable")].filter(
        (block) => {
          const at = block.getBoundingClientRect();
          return at.bottom > shown.top && at.top < shown.bottom;
        },
      );
      const chosen = event.key === "ArrowDown" ? blocks[0] : blocks.at(-1);
      if (chosen === undefined) return;
      event.preventDefault();
      chosen.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", select);
    return () => window.removeEventListener("keydown", select);
  }, [editable]);

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
  // SPIKE: Tab enters the document at the block selected last, or its first block.
  const first = editable ? views.find((view) => editableView(view, ruleCount))?.id : undefined;
  const entry = editing.cursor ?? first ?? (editable ? EDITOR_PLACE.ASSUMPTIONS : undefined);
  return (
    <div ref={scroller} className="plan-document-scroll">
      {edited === undefined ? null : <EditedLine edit={edited} onShowHistory={onShowHistory} />}
      <ChangedLine looks={looks} />
      <div className="plan-body">
        {views.map((view) => (
          <BodyUnit
            key={view.id}
            view={view}
            editable={editable}
            editing={editing}
            ruleCount={ruleCount}
            marks={marks}
            entry={entry}
          />
        ))}
        {editing.editor !== undefined && editing.host === EDITOR_PLACE.END ? (
          <PlanFieldEditor
            heading={`## ${targetLabel(editing.editor.target, ruleCount)}`}
            editor={editing.editor}
            ruleCount={ruleCount}
            editing={editing}
            drawn={null}
          />
        ) : null}
        {content === undefined ? null : <AddSections fields={content.fields} editing={editing} />}
      </div>
      <PlanAssumptions
        assumptions={assumptions}
        fresh={freshAssumptions}
        editable={editable}
        editing={editing}
        marks={marks}
        entry={entry}
      />
    </div>
  );
}
