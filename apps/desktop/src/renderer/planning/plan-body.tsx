import { PLAN_FIELD_HEADING, planTextFieldValue } from "@sidecar/hosted/plan-template";
import {
  PLAN_ACTOR,
  PLAN_FIELD,
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
  DOCUMENT_BLOCK_CLASS,
  DocumentBlock,
  EditableTitle,
  PlanDocumentEditor,
} from "./plan-document-editor";
import {
  EDITOR_PLACE,
  EditableUnit,
  type FieldEditing,
  type PlanEditDoor,
  PlanFieldEditor,
  useFieldEditing,
} from "./plan-field-editor";
import { editTargetOfUnit, targetHeading } from "./plan-field-editor-model";
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
import { documentTitleOf, PlanTitle } from "./plan-title";
import { NO_ASSUMPTIONS_LINE } from "./planning-model";
import { NO_LOOKS, type PlanLooks, sectionSavesOf } from "./use-plan-looks";

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
 * pointer or the keyboard is on it, and its line opens the version history on
 * the revision that save made. The sections changed since the developer
 * last looked at the plan on this Mac wear a still tint, counted under that
 * line, until they dismiss them or leave the plan (`use-plan-looks.ts`).
 * A plan kept as the template's fields draws its body, title line and all,
 * then its assumptions as a section of their own. A plan that is one
 * document draws its name as the title over its text (`plan-title.tsx`),
 * and nothing after it: its assumptions are a section of the text, and each
 * section is known by its heading.
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

/** Opens the plan's version history on the revision that made the save at a moment, or on the plan as it stands. */
type ShowHistory = (save: number | undefined) => void;

/** The line over the document, which opens the plan's history where the window offers it. */
function EditedLine({
  edit,
  onShowHistory,
}: {
  edit: PlanLastEdit;
  onShowHistory: ShowHistory | undefined;
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
        onClick={() => onShowHistory(undefined)}
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
      <button type="button" className="toolbar-button quiet-button" onClick={looks.dismiss}>
        Dismiss
      </button>
    </p>
  );
}

/**
 * What each unit says of its section: the save that last changed each, which
 * changed since the last look, the minute it counts from, and the way into
 * the version history where the window offers one. A section is known by its
 * field in a plan of the template's fields, and by its heading in a plan
 * that is one document.
 */
interface SectionMarks {
  readonly edits: ReadonlyMap<string, PlanLastEdit>;
  readonly changed: ReadonlySet<string>;
  readonly now: number;
  readonly onShowHistory: ShowHistory | undefined;
}

/**
 * The section's quiet line: who last changed the section known by `key`, and
 * when, shown while the pointer or the keyboard is on it; none where no save
 * has. Where the window offers the version history, it opens it on the
 * revision that save made. `heading` names the section to a screen reader.
 */
function bylineOf(marks: SectionMarks, key: string, heading: string): React.JSX.Element | null {
  const edit = marks.edits.get(key);
  if (edit === undefined) return null;
  const line = editedLine(edit, marks.now);
  const { onShowHistory } = marks;
  if (onShowHistory === undefined) return <span className="plan-unit-byline">{line}</span>;
  const named = heading === "" ? line : `${heading}: ${line}`;
  return (
    <button
      type="button"
      className="plan-unit-byline"
      aria-label={`${named}. Show version history`}
      onClick={(event) => {
        // Note that the press stops here, because a click into the section opens its editor.
        event.stopPropagation();
        onShowHistory(edit.at);
      }}
    >
      {line}
    </button>
  );
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
const OPTIONAL_FIELDS = [PLAN_FIELD.ALTERNATIVES, PLAN_FIELD.PLAN_OF_ATTACK] as const;

/** A unit drawn with its section's byline, where a save has changed the section. */
function attributed(drawn: React.JSX.Element, byline: React.JSX.Element | null): React.JSX.Element {
  if (byline === null) return drawn;
  return (
    <div className="plan-unit-attributed">
      {drawn}
      {byline}
    </div>
  );
}

/**
 * One section of a plan that is one document, drawn as the chase has it,
 * tinted where it changed since the last look, and carrying the byline of
 * the save that last changed it, each by its heading.
 */
function DocumentUnit({ view, marks }: { view: UnitView; marks: SectionMarks }): React.JSX.Element {
  const changed = marks.changed.has(view.heading);
  const drawn = (
    <MarkdownMessage words={view.words} className={unitClass(view, changed)} edit={view.edit} />
  );
  return attributed(drawn, bylineOf(marks, view.heading, view.heading));
}

/**
 * One unit of a body of the template's fields: drawn as the chase has it,
 * tinted where its field changed since the last look, the editor where it
 * is the one the editor opened from, nothing where it is the field an
 * editor holds elsewhere, and the way into its editor where it can be
 * edited. Every section carries its field's byline.
 */
function BodyUnit({
  view,
  editable,
  editing,
  marks,
}: {
  view: UnitView;
  editable: boolean;
  editing: FieldEditing;
  marks: SectionMarks;
}): React.JSX.Element | null {
  const target = editTargetOfUnit(view.words);
  const changed = target !== undefined && marks.changed.has(target.field);
  const drawn = (
    <MarkdownMessage words={view.words} className={unitClass(view, changed)} edit={view.edit} />
  );
  if (target === undefined) return drawn;
  const byline = bylineOf(marks, target.field, PLAN_FIELD_HEADING[target.field]);
  if (!editable) return attributed(drawn, byline);
  const { editor, host } = editing;
  if (editor !== undefined && host === view.id) {
    const heading = view.words.split("\n", 1)[0] ?? "";
    return <PlanFieldEditor heading={heading} editor={editor} editing={editing} />;
  }
  if (editor !== undefined && editor.target.field === target.field) return null;
  return (
    <EditableUnit target={target} host={view.id} editing={editing}>
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
}: {
  assumptions: readonly PlanAssumption[];
  fresh: ReadonlySet<number>;
  editable: boolean;
  editing: FieldEditing;
  marks: SectionMarks;
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
      <PlanFieldEditor heading={undefined} editor={editor} editing={editing} />
    ) : editable ? (
      <EditableUnit target={target} host={EDITOR_PLACE.ASSUMPTIONS} editing={editing}>
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
      {bylineOf(marks, PLAN_FIELD.ASSUMPTIONS, PLAN_FIELD_HEADING[PLAN_FIELD.ASSUMPTIONS])}
      {body}
    </section>
  );
}

/**
 * The plan's document: a body of the template's fields and its assumptions,
 * the assumptions' section standing even while the list is empty, or the
 * text of a plan that is one document under its name, the title, with no
 * section after it. `live` is the plan's call in progress, which keeps
 * the caret waiting where the typing last stopped; `onShowHistory` opens the
 * plan's version history from the "Edited by" line, on the plan as it
 * stands, and from a section's, on the revision of the save it names. With
 * `onEdit`, each field of a plan of the template's fields opens in an
 * editor in place; a plan that is one document is drawn read-only.
 * `looks` are the sections changed since the developer last looked, which
 * the plan's region keeps (`use-plan-looks.ts`); without them none are.
 */
export function PlanBody({
  plan,
  live,
  onShowHistory,
  onEdit,
  onRename,
  looks = NO_LOOKS,
}: {
  plan: Plan;
  live: boolean;
  onShowHistory?: ShowHistory;
  onEdit?: PlanEditDoor;
  /** Renames the plan, from its title where the plan is one document. */
  onRename?: (name: string) => void;
  looks?: PlanLooks;
}): React.JSX.Element {
  const { views, behind, freshAssumptions, jumps } = usePlanChase(plan, live);
  const { fields } = plan;
  const title = documentTitleOf(plan);
  // A plan of the template's fields is edited a field at a time; a plan that is one document, whole.
  const textEditable = onEdit !== undefined && title !== undefined;
  const content =
    onEdit === undefined
      ? undefined
      : fields !== undefined
        ? { fields, assumptions: plan.document.assumptions }
        : { text: plan.document.body };
  const editable = onEdit !== undefined && fields !== undefined;
  const editing = useFieldEditing(plan.id, content, onEdit ?? NO_EDIT);
  const now = useMinute();
  const marks: SectionMarks = {
    edits: new Map(sectionSavesOf(plan).map(({ section, ...edit }) => [section, edit])),
    changed: looks.changed,
    now,
    onShowHistory,
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

  // With nothing focused, the arrows select a block of a document, the first
  // in view going down and the last going up, rather than scroll the page.
  // Note that focus anywhere else keeps its own arrows.
  useEffect(() => {
    if (!textEditable) return;
    const select = (event: KeyboardEvent) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const element = scroller.current;
      if (element === null || document.activeElement !== document.body) return;
      const shown = element.getBoundingClientRect();
      const blocks = [...element.querySelectorAll<HTMLElement>(`.${DOCUMENT_BLOCK_CLASS}`)].filter(
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
  }, [textEditable]);

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
  // The document's one Tab stop: the block selected last while it still stands, or its title, or its first section.
  const standing =
    editing.cursor === EDITOR_PLACE.TITLE
      ? onRename !== undefined
      : views.some((view) => view.id === editing.cursor);
  const entry = standing
    ? editing.cursor
    : onRename === undefined
      ? views[0]?.id
      : EDITOR_PLACE.TITLE;
  const sections = views.map((view, section) =>
    textEditable ? (
      <DocumentBlock
        key={view.id}
        host={view.id}
        section={section}
        label={view.heading === "" ? "Section" : view.heading}
        entry={entry === view.id}
        editing={editing}
      >
        <DocumentUnit view={view} marks={marks} />
      </DocumentBlock>
    ) : (
      <DocumentUnit key={view.id} view={view} marks={marks} />
    ),
  );
  const textOpen = editing.editor !== undefined && editing.host === EDITOR_PLACE.DOCUMENT;
  return (
    <div ref={scroller} className="plan-document-scroll">
      {edited === undefined ? null : <EditedLine edit={edited} onShowHistory={onShowHistory} />}
      <ChangedLine looks={looks} />
      <div className="plan-body">
        {title === undefined ? null : textEditable && onRename !== undefined ? (
          <EditableTitle
            name={title}
            entry={entry === EDITOR_PLACE.TITLE}
            editing={editing}
            onRename={onRename}
          />
        ) : (
          <PlanTitle name={title} />
        )}
        {title === undefined ? (
          views.map((view) => (
            <BodyUnit
              key={view.id}
              view={view}
              editable={editable}
              editing={editing}
              marks={marks}
            />
          ))
        ) : textOpen && editing.editor !== undefined ? (
          <PlanDocumentEditor
            plan={plan}
            editor={editing.editor}
            editing={editing}
            drawn={sections}
            hostOf={(section) => views[section]?.id ?? EDITOR_PLACE.TITLE}
          />
        ) : (
          sections
        )}
        {editing.editor !== undefined && editing.host === EDITOR_PLACE.END ? (
          <PlanFieldEditor
            heading={`## ${targetHeading(editing.editor.target)}`}
            editor={editing.editor}
            editing={editing}
          />
        ) : null}
        {fields === undefined || !editable ? null : (
          <AddSections fields={fields} editing={editing} />
        )}
      </div>
      {title === undefined ? (
        <PlanAssumptions
          assumptions={assumptions}
          fresh={freshAssumptions}
          editable={editable}
          editing={editing}
          marks={marks}
        />
      ) : null}
    </div>
  );
}
