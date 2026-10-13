import { PLAN_ACTOR, type Plan, type PlanLastEdit } from "@sidecar/hosted/plan-wire";
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
  type ChaseState,
  chaseBehind,
  chaseOpened,
  chaseRetargeted,
  chaseStepped,
  chaseView,
  type UnitView,
} from "./plan-reveal";
import { useMinute } from "./plan-time";
import { PlanTitle } from "./plan-title";
import { EDITOR_PLACE, type PlanEditDoor, usePlanEditing } from "./use-plan-editing";
import { NO_LOOKS, type PlanLooks } from "./use-plan-looks";

/**
 * plan-body.tsx -- the open plan's document as it scrolls between the header and the microphone row, typing in each newer document as it arrives.
 *
 * Every document the host hands over for the open plan becomes the chase's
 * target, whether a saved plan or a draft still being written, so a stream of
 * drafts is worked in by one continuous hand rather than restarting on each.
 * The view follows the caret, bringing a jump to the middle, unless the
 * developer has scrolled the document themselves, and lights each unit as it settles. Opening
 * a plan draws it whole, and reduced motion draws each document at once. The
 * typing grows the scrolled document and never the surface. A plan anyone has written
 * says who last did in one muted line above the document: the developer,
 * Luke (the notetaker), or a coding agent named as its row names it now,
 * whether it was on a call, and how long ago, moved on once a minute. The
 * line opens the plan's version history, where each earlier version is. Each
 * section says the same of the save that last changed it, quietly, while the
 * pointer or the keyboard is on it, and its line opens the version history on
 * the revision that save made. The sections changed since the developer
 * last looked at the plan on this Mac wear a still tint, counted under that
 * line, until they dismiss them or leave the plan (`use-plan-looks.ts`).
 * The plan's name is drawn as the title over its text (`plan-title.tsx`),
 * and each section is known by its heading.
 */

/** The document the chase was last aimed at, the last edit it was, and where its typing stands. */
interface Chase {
  readonly planId: string;
  readonly body: string;
  readonly lastEditAt: number | undefined;
  readonly state: ChaseState;
}

/** What the document draws from the chase this frame. */
interface PlanChase {
  readonly views: readonly UnitView[];
  readonly behind: boolean;
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
 * the version history where the window offers one, each by its heading.
 */
interface SectionMarks {
  readonly edits: ReadonlyMap<string, PlanLastEdit>;
  readonly changed: ReadonlySet<string>;
  readonly now: number;
  readonly onShowHistory: ShowHistory | undefined;
}

/**
 * The section's quiet line: who last changed the section under `heading`,
 * and when, shown while the pointer or the keyboard is on it; none where no
 * save has. Where the window offers the version history, it opens it on the
 * revision that save made.
 */
function bylineOf(marks: SectionMarks, heading: string): React.JSX.Element | null {
  const edit = marks.edits.get(heading);
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

/** The class of a unit lit as it settles. */
const FRESH_CLASS = "plan-fresh";

/** The class of the unit the caret is typing in, whose heading wears the writing mark. */
const WRITING_CLASS = "plan-writing";

/** The class of the unit the caret waits at the end of, where it blinks. */
const RESTING_CLASS = "plan-caret-resting";

/** The class of a section changed since the developer last looked, tinted until they dismiss it. */
const CHANGED_CLASS = "plan-changed";

/** The presses that say the developer is reading somewhere of their own, which the caret stops following. */
const SCROLL_INTENT_EVENTS = ["wheel", "pointerdown", "keydown"] as const;

function opened(plan: Plan): Chase {
  const { body } = plan.document;
  return {
    planId: plan.id,
    body,
    lastEditAt: plan.lastEdit?.at,
    state: chaseOpened(body),
  };
}

/** The chase aimed at the plan as handed over now: a new target for the same plan, a fresh start for another. */
function aimed(chase: Chase, plan: Plan): Chase {
  if (chase.planId !== plan.id) return opened(plan);
  const { body } = plan.document;
  // The developer's own edit lands at once: they watched it being typed already.
  const lastEditAt = plan.lastEdit?.at;
  const ownEdit = plan.lastEdit?.actor === PLAN_ACTOR.DEVELOPER && lastEditAt !== chase.lastEditAt;
  // Read at the retarget rather than held, since it is the one moment it decides anything.
  const aim = { reduced: ownEdit || prefersReducedMotion() };
  const state = chaseRetargeted(chase.state, body, aim);
  return { planId: plan.id, body, lastEditAt, state };
}

/**
 * The chase over the plan handed in, stepped once a frame while any unit is
 * behind. A document arriving mid-typing is aimed at from what is shown, so
 * the typing carries on toward it without a jump.
 */
function usePlanChase(plan: Plan, live: boolean): PlanChase {
  const [chase, setChase] = useState(() => opened(plan));
  let current = chase;
  if (chase.planId !== plan.id || chase.body !== plan.document.body) {
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
    jumps: current.state.jumps,
  };
}

function unitClass(view: UnitView, changed: boolean): string {
  const lit = changed ? ` ${CHANGED_CLASS}` : "";
  if (view.writing) return `plan-unit ${WRITING_CLASS}${lit}`;
  if (view.resting) return `plan-unit ${RESTING_CLASS}${view.fresh ? ` ${FRESH_CLASS}` : ""}${lit}`;
  return view.fresh ? `plan-unit ${FRESH_CLASS}${lit}` : `plan-unit${lit}`;
}

/** The door of a document nothing is edited through: every edit answered as unanswered. */
const NO_EDIT: PlanEditDoor = () => Promise.reject(new Error("This plan cannot be edited here."));

/** Where a title's draft goes when nothing else names the plan: nowhere. */
const NO_DRAFT = (_name: string | undefined): void => undefined;

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
 * One section of the text, drawn as the chase has it, tinted where it
 * changed since the last look, and carrying the byline of the save that
 * last changed it, each by its heading.
 */
function DocumentUnit({ view, marks }: { view: UnitView; marks: SectionMarks }): React.JSX.Element {
  const changed = marks.changed.has(view.heading);
  const drawn = (
    <MarkdownMessage words={view.words} className={unitClass(view, changed)} edit={view.edit} />
  );
  return attributed(drawn, bylineOf(marks, view.heading));
}

/**
 * The plan's document: its name as the title over its text. `live` is the
 * plan's call in progress, which keeps the caret waiting where the typing
 * last stopped; `onShowHistory` opens the plan's version history from the
 * "Edited by" line, on the plan as it stands, and from a section's, on the
 * revision of the save it names. With `onEdit`, the text is edited whole in
 * place, and with `onRename` the title too, its words drawn as the plan's
 * name through `onDraftName` as they are typed; without them the document is
 * drawn read-only. `looks` are the sections changed since the developer last
 * looked, which the plan's region keeps (`use-plan-looks.ts`); without them
 * none are.
 */
export function PlanBody({
  plan,
  live,
  onShowHistory,
  onEdit,
  onRename,
  onDraftName = NO_DRAFT,
  looks = NO_LOOKS,
}: {
  plan: Plan;
  live: boolean;
  onShowHistory?: ShowHistory;
  onEdit?: PlanEditDoor;
  /** Renames the plan, from its title, answering whether the name was taken. */
  onRename?: (name: string) => Promise<boolean>;
  /** Draws the name typed into the title wherever the plan is named, or none once it is left. */
  onDraftName?: (name: string | undefined) => void;
  looks?: PlanLooks;
}): React.JSX.Element {
  const { views, behind, jumps } = usePlanChase(plan, live);
  const editable = onEdit !== undefined;
  const text = editable ? plan.document.body : undefined;
  const editing = usePlanEditing(plan.id, text, onEdit ?? NO_EDIT);
  const now = useMinute();
  const marks: SectionMarks = {
    edits: new Map((plan.sectionEdits ?? []).map(({ section, ...edit }) => [section, edit])),
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
    if (!editable) return;
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
    editable ? (
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
  return (
    <div ref={scroller} className="plan-document-scroll">
      {edited === undefined ? null : <EditedLine edit={edited} onShowHistory={onShowHistory} />}
      <ChangedLine looks={looks} />
      <div className="plan-body">
        {editable && onRename !== undefined ? (
          // Keyed by the plan, so words typed for one are saved to it as another opens.
          <EditableTitle
            key={plan.id}
            name={plan.name}
            entry={entry === EDITOR_PLACE.TITLE}
            editing={editing}
            onRename={onRename}
            onDraft={onDraftName}
          />
        ) : (
          <PlanTitle name={plan.name} />
        )}
        {editing.editor === undefined ? (
          sections
        ) : (
          <PlanDocumentEditor
            plan={plan}
            editor={editing.editor}
            editing={editing}
            drawn={sections}
            hostOf={(section) => views[section]?.id ?? EDITOR_PLACE.TITLE}
          />
        )}
      </div>
    </div>
  );
}
