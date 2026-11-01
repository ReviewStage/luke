import {
  encodeMention,
  MENTION_KIND,
  type MentionLines,
  type MentionPlace,
  type PlanMention,
  sectionAnchors,
} from "@luke/features/mention-link";
import type { PlanCommentThread } from "@luke/features/plan-comment-wire";
import { type PlanSection, planSections } from "@luke/features/plan-document";
import { FAILURE_CONDITION, FAILURE_SURFACE } from "@luke/features/shown-failure";
import {
  PLAN_ACTOR,
  type PlanLastEdit,
  type PlanSectionEdit,
  type Task,
} from "@luke/features/task-wire";
import { agoText, momentText, sinceText } from "@luke/features/time-format";
import {
  Button,
  EDITABLE_BLOCK_CLASS,
  IconButton,
  SavedTick,
  STATUS_TONE,
  TEXT_BUTTON_LINES,
  TEXT_TONE,
  Text,
  TextButton,
  Tooltip,
  useMinute,
  VisuallyHidden,
} from "@luke/ui";
import { actorName } from "@luke/ui/actor-model";
import { GLYPH } from "@luke/ui/icons";
import type { MarkdownTaskToggler } from "@luke/ui/markdown";
import { commentSpansIn, usePlanCommentsControl } from "@luke/ui/plan-comments";
import { diffArrays } from "diff";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KEPT, type Kept, notKept } from "../act.js";
import { ActorStack } from "../actor-ref.js";
import { usePrefetchEditorBundle } from "../bundle-loader.js";
import { LINK_COPY, useCopyToast } from "../copy-feedback.js";
import { VERSION_HISTORY } from "../desktop/pages-on-demand.js";
import { useEditedLinksHost } from "../link-menu.js";
import {
  type LinkDrawer,
  MARKDOWN_MARK,
  type MarkdownEdit,
  MarkdownMessage,
} from "../markdown-message.js";
import { useCreator } from "../member-directory.js";
import { PLACEMENT_END, PLAN_PLACEHOLDER, type PlanEditorHandle } from "../plan-editor/contract.js";
import { useSteadyDoor } from "../steady-door.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { DocumentByline, DocumentScroll } from "./document-frame.js";
import {
  type EditAgents,
  EditedBy,
  type EditPlace,
  editorsOf,
  type TaskReader,
  useEditReader,
} from "./edit-ref.js";
import { type MentionDoors, mentionLinkDrawer } from "./mention-chip.js";
import { PlanCommentLayer, useCommentFocus, useEditorComment } from "./plan-comments.js";
import {
  DocumentBlock,
  EditableTitle,
  PlanDocumentEditor,
  textBoxOf,
  useTextRoom,
  useWordsKeptOnClose,
} from "./plan-document-editor.js";
import { PlanPictures, usePlanPictureDrawer } from "./plan-pictures.js";
import { UNIT_ATTRIBUTED_CLASS, UNIT_BYLINE_CLASS, UNIT_MORE_CLASS } from "./plan-unit-look.js";
import { TaskPath, TaskStandingChips, type TaskStandingDoor } from "./task-standing.js";
import { TaskTitle } from "./task-title.js";
import { useOpenLink } from "./use-open-link.js";
import { EDITOR_PLACE, type PlanEditDoor, usePlanEditing } from "./use-plan-editing.js";
import { NO_LOOKS, type TaskLooks } from "./use-task-looks.js";
import { useTaskMaker } from "./use-task-origin.js";
import {
  useWordsDatePicker,
  WordsDatePickerRoom,
  type WordsDates,
  WordsDatesContext,
  wordsDatesDoor,
} from "./words-dates.js";

/**
 * plan-body.tsx -- the open task's document as it scrolls between the header and the microphone row, redrawn in place as each newer document arrives.
 *
 * Every document the host hands over for the open task is drawn whole, each
 * section keeping its place while its heading stands, so a save redraws the
 * sections it changed and leaves the scroll where it was. Under the title
 * one muted line says who created the task and how long ago, and, for a plan
 * anyone has written, who last did: a member, Luke (the notetaker), or a
 * coding agent, each on their own face hanging their card (`edit-ref.tsx`),
 * whose call it was on where Luke wrote it on one, and how long ago, moved
 * on once a minute, as a GitHub issue's page says it under its title. The edit's
 * time opens the plan's version history, where each earlier version is. Each section says the
 * same of the save that last changed it in fewer letters, quietly, while the
 * pointer or the keyboard is on it: the writer's face, whose card names them,
 * and the time, "2h", at the end of a heading that always keeps room for
 * them, so they never stand over its words. Its time opens the version
 * history on the revision that save made. The words before the
 * first heading have no heading's line for it to stand at, so they carry no
 * line in the text, where it would stand over their words or a picture; a
 * picture of the plan, opened over the window, says who last changed its
 * section in the viewer's header instead. The sections changed since
 * the developer last looked at the task on this Mac wear a still tint,
 * counted under that line beside a face for each who changed them, until
 * they dismiss them or leave the task (`use-task-looks.ts`).
 * The task's name is drawn as the title over its text (`task-title.tsx`),
 * and each section is known by its heading, and its link by the heading's
 * anchor (`sectionAnchors`). A Mermaid fence draws as its diagram
 * (`../plan-diagram.tsx`).
 *
 * On a task's own page each section has a link: its ⋯, shown while the
 * pointer or the keyboard is on it, copies the section's address
 * (`@luke/features/mention-link`), which a transcript or the plan draws as
 * the section's chip wherever it is pasted, and a mention in the
 * plan's words is drawn as its chip (`mention-chip.tsx`), which opens the
 * section it names. The title has a ⋯ of its own, drawn as a section's is,
 * which copies the task's link and offers Rename, where the title can be
 * edited, and Version history, where the window opens it
 * (`task-menu-items.tsx`). Asked to show a section, the document scrolls
 * its own scroller to it, never `scrollIntoView`, which would scroll every box
 * around it too; a section the plan no longer holds leaves it at its top.
 */

/** What a task's own page does with its sections' links and its mentions: the slug of the workspace its links are written under, what opens the task or a section a mention names, or a file's tab, and the section it was last asked to show. */
export interface SectionLinks {
  readonly workspace: string;
  readonly onOpen: (mention: PlanMention) => void;
  readonly onOpenFile?: ((path: string, lines: MentionLines | undefined) => void) | undefined;
  readonly reveal: SectionReveal | undefined;
  /** The document showed the section `reveal` asked for, so the ask can be let go. */
  readonly onRevealed?: ((ask: number) => void) | undefined;
  /** The task's agents and their pull requests as their tabs hang them, which a chip naming one hangs (`MentionDoors`); none where the page knows the task's agents not. */
  readonly agentOf?: MentionDoors["agentOf"];
  readonly pullRequestOf?: MentionDoors["pullRequestOf"];
}

/** One ask to show a section by its anchor, or the plan's top where it names none; each ask is its own, so the same section asked twice scrolls twice. */
export interface SectionReveal {
  readonly anchor: string | undefined;
  readonly ask: number;
}

/** The task a page's sections link to, and where its links are written. */
interface LinkedTask {
  readonly taskId: string;
  readonly place: MentionPlace;
}

/** The room left above a section scrolled to, so its heading does not stand flush against the document's top edge. */
const REVEAL_MARGIN = 16;

/** The room left above a section the scroller reveals: its scroll padding where that is wider, which clears its faded top edge (its `ScrollArea`'s fade). */
function revealMargin(scroller: HTMLElement): number {
  const padding = Number.parseFloat(getComputedStyle(scroller).scrollPaddingTop);
  return Number.isNaN(padding) ? REVEAL_MARGIN : Math.max(padding, REVEAL_MARGIN);
}

/** One section of the text as drawn: its identity while it stands, the heading it is known by, and its words. */
interface UnitView {
  /** Minted when the section first appears and kept while it stands, so a view can key it. */
  readonly id: number;
  /** The heading the section is known by, empty for the words before the first. */
  readonly heading: string;
  readonly words: string;
}

/** The document the sections were last cut from, the sections cut from it, and the id the next to appear is given. */
interface DrawnUnits {
  readonly taskId: string;
  readonly body: string;
  readonly sections: readonly PlanSection[];
  readonly views: readonly UnitView[];
  readonly nextId: number;
}

/**
 * The plan's last edit: its newest revision, or, from a service before
 * history, the newest save a coding agent made, which was all it could name.
 */
export function lastEditOf(task: Task): PlanLastEdit | undefined {
  if (task.lastEdit !== undefined) return task.lastEdit;
  // The journal is oldest first, so the newest save is its last.
  const journaled = task.agentEdits?.at(-1);
  if (journaled === undefined) return undefined;
  return {
    actor: PLAN_ACTOR.AGENT,
    label: journaled.label,
    agentId: journaled.agentId,
    at: journaled.at,
    duringCall: false,
  };
}

/** Nobody, as a capture or a test draws the plan, who reads no edit as theirs. */
const NO_READER: TaskReader = { readerId: undefined };

/** Opens the plan's version history on the revision that made the save at a moment, or on the plan as it stands. */
type ShowHistory = (save: number | undefined) => void;

/**
 * How long ago an edit was, in a line naming it, as the press that opens the
 * version history on it where the window offers one, and as words otherwise.
 * `label` is what the press is called. `short` says it in a row's few
 * letters, "2h", a date without its year, with the full moment on hover,
 * for a section's byline, which keeps to a fixed room. Note that the press
 * stops there, because a click into a section opens its editor.
 */
function EditTime({
  at,
  label,
  onShow,
  short = false,
  whole = false,
}: {
  at: number;
  /** What the press is called, from how long ago the edit was, "2 hours ago". */
  label: (ago: string) => string;
  onShow: (() => void) | undefined;
  short?: boolean;
  /** Whether its press is drawn whole, a finger's press on a coarse pointer, as the byline's is. */
  whole?: boolean;
}): React.JSX.Element {
  // Note that the time reads the minute itself, so the minute draws it again and not the section it stands in.
  const now = useMinute();
  const words = short ? sinceText(at, now, { year: false }) : agoText(at, now);
  const time =
    onShow === undefined ? (
      <span>{words}</span>
    ) : (
      <TextButton
        lines={whole ? TEXT_BUTTON_LINES.WHOLE : TEXT_BUTTON_LINES.ONE}
        aria-label={label(agoText(at, now))}
        // The pointer on the time is the way to the history, so its chunk is read now rather than at the press.
        onPointerEnter={VERSION_HISTORY.prefetch}
        onFocus={VERSION_HISTORY.prefetch}
        onClick={(event) => {
          event.stopPropagation();
          onShow();
        }}
      >
        {words}
      </TextButton>
    );
  return short ? <Tooltip label={momentText(at)}>{time}</Tooltip> : time;
}

/**
 * What an editable plan with no text says at rest, the editor's own
 * placeholder in a quieter ink, so the room does not read as blank; its
 * press opens the editor, and the pointer or the keyboard reaching it reads
 * the editor's bundle ahead, as a section's block does.
 */
function EmptyPlanLine({ onOpen }: { onOpen: () => void }): React.JSX.Element {
  const prefetchEditorBundle = usePrefetchEditorBundle();
  return (
    <Text tone={TEXT_TONE.MUTED}>
      <TextButton
        onPointerEnter={prefetchEditorBundle}
        onFocus={prefetchEditorBundle}
        onClick={onOpen}
      >
        {PLAN_PLACEHOLDER}
      </TextButton>
    </Text>
  );
}

/** The press that opens the history from a plan's last edit, by how long ago it was. */
const editedLabel = (ago: string): string => `Edited ${ago}. Show version history`;

/** How long ago a moment was, in words, drawn again as the minute turns. */
function Ago({ at }: { at: number }): React.JSX.Element {
  return <span>{agoText(at, useMinute())}</span>;
}

/**
 * Who started the task and when, and when its plan was last edited, under
 * its title, in the line every document draws there (`DocumentByline`):
 * "Created by [Charles] Charles Pan · 3d ago" and "Edited 2h ago", each
 * phrase wrapping whole. The creator hangs their card, and the edit's time
 * opens the plan's version history where the window offers it. Who last
 * edited it is the task's ⋯ menu's to say, in its footer. A plan nobody has
 * edited says only who created it.
 */
function PlanByline({
  task,
  edit,
  place,
  saves,
  onShowHistory,
}: {
  task: Task;
  edit: PlanLastEdit | undefined;
  place: EditPlace;
  /** How many of the reader's saves of this plan landed, which its Saved tick confirms. */
  saves: number;
  onShowHistory: ShowHistory | undefined;
}): React.JSX.Element {
  // Note that the creator is named as the task's ⋯ names them, so a task the service names by its owner's id alone is still the reader's own.
  const creator = useCreator(task, place.reader.readerId);
  const maker = useTaskMaker(task);
  const now = useMinute();
  return (
    <DocumentByline
      creator={creator}
      maker={maker}
      createdAt={task.createdAt}
      now={now}
      edited={
        edit === undefined ? undefined : (
          <>
            {"Edited "}
            <EditTime
              at={edit.at}
              label={editedLabel}
              onShow={onShowHistory === undefined ? undefined : () => onShowHistory(undefined)}
              whole
            />
          </>
        )
      }
      saved={<SavedTick saves={saves} />}
    />
  );
}

/** How many sections changed since the last look, as the line under the byline counts them, and by whom where any is named. */
function changedLine(count: number, named: boolean): string {
  const sections = `${count} ${count === 1 ? "section" : "sections"}`;
  return `Changed since you last looked · ${sections}${named ? " by " : ""}`;
}

/**
 * The line under the title's byline while sections changed since the last look
 * stand lit, a face for each who last changed them, with their dismissal.
 * Note that the faces are named in words a screen reader reads, since a
 * facepile is hidden from it.
 */
function ChangedLine({
  looks,
  marks,
}: {
  looks: TaskLooks;
  marks: SectionMarks;
}): React.JSX.Element | null {
  if (looks.changed.size === 0) return null;
  const edits = [...looks.changed].flatMap((heading) => marks.edits.get(heading) ?? []);
  const editors = editorsOf(edits, marks.place);
  // Note that the line keeps the room it always had under "Edited by" and Dismiss overhangs it, so the button does not push the document down.
  return (
    <p className="plan-changed-note -mt-luke-6 mb-luke-12 mx-0 flex h-plan-changed-note items-center gap-item-gap text-caption text-muted-foreground">
      <span className="actor-line">
        {changedLine(looks.changed.size, editors.length > 0)}
        {editors.length === 0 ? null : (
          <>
            <ActorStack actors={editors} />
            <VisuallyHidden>
              {editors.map((actor) => actorName(actor, { sentence: true })).join(", ")}
            </VisuallyHidden>
          </>
        )}
      </span>
      <span aria-hidden="true">·</span>
      <Button onClick={looks.dismiss}>Dismiss</Button>
    </p>
  );
}

/**
 * What each unit says of its section: the save that last changed each, which
 * changed since the last look, what names who made it, and the way into the
 * version history where the window offers one, each by its heading.
 */
interface SectionMarks {
  readonly edits: ReadonlyMap<string, PlanLastEdit>;
  readonly changed: ReadonlySet<string>;
  readonly place: EditPlace;
  readonly onShowHistory: ShowHistory | undefined;
}

/**
 * The section's quiet line: the face of who last changed the section under
 * `heading`, hanging their card, which names them and whose call it was,
 * and when in a row's few letters, "[Luke] 2h", shown while the pointer or
 * the keyboard is on it, at the end of a heading that keeps room for it;
 * none where no save has, or for the words before the first heading, which
 * have no heading's line for it to stand at. Where the window offers the
 * version history, the time opens it on the revision that save made.
 */
function bylineOf(marks: SectionMarks, heading: string): React.JSX.Element | null {
  if (heading === "") return null;
  const edit = marks.edits.get(heading);
  if (edit === undefined) return null;
  const { onShowHistory, place } = marks;
  return (
    <span className={UNIT_BYLINE_CLASS}>
      {edit.actor === PLAN_ACTOR.EARLIER ? (
        "Edited"
      ) : (
        <EditedBy edit={edit} place={place} faceOnly />
      )}{" "}
      <EditTime
        at={edit.at}
        label={(ago) => `${heading}: edited ${ago}. Show version history`}
        onShow={onShowHistory === undefined ? undefined : () => onShowHistory(edit.at)}
        short
      />
    </span>
  );
}

/**
 * What the picture viewer says of a picture of the plan: who last changed
 * the section under `heading` it stands in, and when, "Edited by [Charles]
 * Charles Pan · 2h ago"; none where no save has. Note that the time is
 * words rather than the history's door, which would open behind the viewer.
 */
function pictureNoteOf(marks: SectionMarks, heading: string): React.JSX.Element | null {
  const edit = marks.edits.get(heading);
  if (edit === undefined) return null;
  const { place } = marks;
  return (
    <span className="actor-line">
      {edit.actor === PLAN_ACTOR.EARLIER ? "Edited" : "Edited by "}
      <EditedBy edit={edit} place={place} sentence />
      {" · "}
      <Ago at={edit.at} />
    </span>
  );
}

/** The class every unit of the text wears, one per section in the order the sections stand. */
const UNIT_CLASS = "plan-unit";

/** The class of a section changed since the developer last looked, tinted until they dismiss it. */
const CHANGED_CLASS =
  "plan-changed relative isolate after:pointer-events-none after:absolute after:-inset-x-luke-6 after:-inset-y-luke-2 after:-z-1 after:rounded-luke-6 after:bg-plan-changed";

/** The class of the column the title and the text stand in. */
const BODY_CLASS = "plan-body";

/**
 * Each section of a newer document drawn under the id it had in the older
 * while its heading stands, so a save redraws a section in place rather than
 * as a new one. Headings are paired in document order; a run of older
 * headings the newer document dropped, beside a run it added in the same
 * place, is the same sections renamed, and pairs one for one. Every other
 * section is new, and takes the next id.
 */
function unitsAfter(
  previous: readonly UnitView[],
  sections: readonly PlanSection[],
  firstId: number,
): { readonly views: readonly UnitView[]; readonly nextId: number } {
  const changes = diffArrays(
    previous.map((view) => view.heading),
    sections.map((section) => section.heading),
  );
  const views: UnitView[] = [];
  let nextId = firstId;
  const place = (kept: number | undefined): void => {
    const section = sections[views.length];
    if (section === undefined) return;
    const id = kept ?? nextId;
    if (kept === undefined) nextId += 1;
    views.push({ id, heading: section.heading, words: section.text });
  };
  let before = 0;
  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index];
    if (change === undefined) continue;
    const count = change.value.length;
    if (change.added) {
      for (let at = 0; at < count; at += 1) place(undefined);
      continue;
    }
    if (!change.removed) {
      for (let at = 0; at < count; at += 1) place(previous[before + at]?.id);
      before += count;
      continue;
    }
    // A run dropped beside a run added in its place is the same sections renamed, which keep their ids.
    const beside = changes[index + 1];
    if (beside?.added === true) {
      for (let at = 0; at < beside.value.length; at += 1) {
        place(at < count ? previous[before + at]?.id : undefined);
      }
      index += 1;
    }
    before += count;
  }
  return { views, nextId };
}

/** A task's document cut into its sections, each keeping its id from the same task's document before. */
function drawnUnits(task: Task, held: DrawnUnits | undefined): DrawnUnits {
  const { body } = task.document;
  const sections = planSections(body);
  const same = held?.taskId === task.id ? held : undefined;
  const { views, nextId } = unitsAfter(same?.views ?? [], sections, same?.nextId ?? 0);
  return { taskId: task.id, body, sections, views, nextId };
}

/** The sections of the plan handed in, cut again as each newer document arrives. */
function useDrawnUnits(task: Task): DrawnUnits {
  const [held, setHeld] = useState(() => drawnUnits(task, undefined));
  let current = held;
  if (held.taskId !== task.id || held.body !== task.document.body) {
    current = drawnUnits(task, held);
    setHeld(current);
  }
  return current;
}

function unitClass(changed: boolean): string {
  return changed ? `${UNIT_CLASS} ${CHANGED_CLASS}` : UNIT_CLASS;
}

/**
 * What draws the plan's mentions as chips, on a task's own page: a link
 * whose destination names a mention, whoever wrote it (`linkMention`),
 * drawn against the anchors of the plan's headings as they stand; nothing
 * off a task's page, where mentions stay words. Note that it is made again
 * only when a heading changes, since every unit's words are drawn again
 * when it is, and that what opening one does is read as it is pressed.
 */
function useMentionChips(
  linked: LinkedTask | undefined,
  anchors: readonly string[],
  links: SectionLinks | undefined,
): { readonly link: LinkDrawer | undefined; readonly doors: MentionDoors | undefined } {
  const latest = useRef(links);
  latest.current = links;
  const opensFiles = links?.onOpenFile !== undefined;
  // Note that these two are steady doors, the same across draws, so the chips are drawn again only when one comes or goes.
  const agentOf = links?.agentOf;
  const pullRequestOf = links?.pullRequestOf;
  const taskId = linked?.taskId;
  const workspace = linked?.place.workspace ?? "";
  const repository = linked?.place.repository ?? null;
  const anchorKey = anchors.join("\n");
  return useMemo(() => {
    if (taskId === undefined) return { link: undefined, doors: undefined };
    const doors: MentionDoors = {
      holder: { taskId },
      place: { workspace, repository },
      anchors: new Set(anchorKey.split("\n").filter((anchor) => anchor !== "")),
      onOpenTask: (mention) => latest.current?.onOpen(mention),
      onOpenFile: opensFiles
        ? (path, lines) => latest.current?.onOpenFile?.(path, lines)
        : undefined,
      agentOf,
      pullRequestOf,
    };
    return { link: mentionLinkDrawer(doors), doors };
  }, [opensFiles, agentOf, pullRequestOf, taskId, workspace, repository, anchorKey]);
}

/** The door of a document nothing is edited through: every edit answered as unanswered. */
const NO_EDIT: PlanEditDoor = () => Promise.reject(new Error("This plan cannot be edited here."));

/** Where a title's draft goes when nothing else names the task: nowhere. */
const NO_DRAFT = (_name: string | undefined): void => undefined;

/** A task item's opening as written: its list marker, then its box, unticked or ticked. */
const TASK_ITEM = /^(?:[-*+]|\d{1,9}[.)])[ \t]+\[([ \txX])\]/u;

/** The task item whose marker starts at `at`: where its box stands, and its line with the box blanked, which reads the same ticked or not; nothing where no task item starts there. */
function taskItemAt(text: string, at: number): { box: number; line: string } | undefined {
  const item = TASK_ITEM.exec(text.slice(at));
  if (item === null) return undefined;
  const box = at + item[0].length - 2;
  const end = text.indexOf("\n", at);
  return {
    box,
    line: `${text.slice(at, box)} ${text.slice(box + 1, end === -1 ? undefined : end)}`,
  };
}

/**
 * The text with the task item whose marker starts at `at` ticked or cleared
 * as `ticked` says, every other character as it was; nothing where no task
 * item starts there, or where its line no longer reads `line`.
 */
function taskSet(text: string, at: number, line: string, ticked: boolean): string | undefined {
  const item = taskItemAt(text, at);
  if (item === undefined || item.line !== line) return undefined;
  return `${text.slice(0, item.box)}${ticked ? "x" : " "}${text.slice(item.box + 1)}`;
}

/**
 * A plan's writes from its words at rest, ticks and dates, in the order they
 * were made: the last one out, which the next waits on, and the text the last
 * one saved left, with the task and the drawn text it was written over, which
 * stands until the saved plan is drawn.
 */
interface PlanWrites {
  last: Promise<Kept>;
  saved: { readonly taskId: string; readonly over: string; readonly text: string } | undefined;
}

/** The plan as drawn when a write is sent: its task and its text. */
interface DrawnPlan {
  readonly id: string;
  readonly body: string;
}

/** The plan's text as it stands: the text a write saved while its task's plan drawn is still the one it was written over, or the plan drawn. */
function planTextNow(writes: PlanWrites, drawn: DrawnPlan): string {
  const saved = writes.saved;
  return saved !== undefined && saved.taskId === drawn.id && saved.over === drawn.body
    ? saved.text
    : drawn.body;
}

/** `write` sent once every write before it settles, answering whether it saved, with what refused it where it did not. */
function queuedWrite(writes: PlanWrites, write: () => Promise<Kept> | Kept): Promise<Kept> {
  const sent = writes.last.then(write);
  writes.last = sent;
  return sent;
}

/**
 * The plan saved from `base` to `value` while `drawn` stands, answering
 * whether it saved, with the answer or error that refused it where it did
 * not; once saved, `kept` stands as the plan's text until the
 * plan drawn moves, or nothing does where it is not known.
 */
function savedOver(
  writes: PlanWrites,
  save: PlanEditDoor,
  drawn: DrawnPlan,
  edit: { readonly base: string; readonly value: string },
  kept: string | undefined,
): Promise<Kept> {
  return save({ document: edit }).then((answer) => {
    if (!("saved" in answer)) return notKept(answer);
    writes.saved =
      kept === undefined ? undefined : { taskId: drawn.id, over: drawn.body, text: kept };
    return KEPT;
  }, notKept);
}

/** What a toast says where a tick or a date written from the plan at rest was not saved. */
const PLAN_NOT_SAVED = "The plan could not be saved.";

/** A list item with a box, as anywhere in a unit's words it may stand: under a quote's marker, say. */
const TASK_ITEM_ANYWHERE = /(?:[-*+]|\d{1,9}[.)])[ \t]+\[[ \txX]\]/u;

/** No section's save named, as a plan from a service before sections were named has. */
const NO_SECTION_EDITS: readonly PlanSectionEdit[] = [];

/** A unit drawn with its section's byline, where a save has changed the section, and its ⋯, where it has a link. */
function attributed(
  drawn: React.JSX.Element,
  byline: React.JSX.Element | null,
  menu: React.JSX.Element | null,
): React.JSX.Element {
  if (byline === null && menu === null) return drawn;
  // Note that the byline and the ⋯ share one row, because a row centres the
  // line on the button's box where two separately placed boxes never quite do.
  // The row hangs past the column's edge by `--luke-space-6`, as the ⋯ always
  // has, and takes no pointer itself, only its byline and its ⋯ do.
  return (
    <div className={UNIT_ATTRIBUTED_CLASS}>
      {drawn}
      <div className="plan-unit-row pointer-events-none absolute top-0 -right-luke-6 flex h-control w-plan-unit-row items-center justify-end gap-tight-gap">
        {byline}
        {menu}
      </div>
    </div>
  );
}

/**
 * A unit's Copy link at its row's end, a section's or the title's: shown while
 * the pointer or the keyboard is on its unit, and answered with the window's
 * toast as Copy link in a menu is.
 */
function UnitLinkButton({
  link,
  tabbable,
}: {
  /** The unit's bare address, as every Copy link copies, so it pastes into Slack or a pull request as a link rather than as markdown. */
  link: string;
  /** Whether it is a Tab stop: only beside the document's one, its unit's block. */
  tabbable: boolean;
}): React.JSX.Element {
  const copy = useCopyToast();
  return (
    <span className={UNIT_MORE_CLASS}>
      <Tooltip label={LINK_COPY.LABEL}>
        <IconButton
          icon={<GLYPH.LINK />}
          label={LINK_COPY.LABEL}
          tabbable={tabbable}
          onClick={(event) => {
            // Note that the press stops here, because a click into a section opens its editor.
            event.stopPropagation();
            copy(link, LINK_COPY.COPIED);
          }}
        />
      </Tooltip>
    </span>
  );
}

/** A section's Copy link button. */
function SectionLink({
  linked,
  anchor,
  tabbable,
}: {
  linked: LinkedTask;
  anchor: string;
  tabbable: boolean;
}): React.JSX.Element {
  const link = encodeMention(
    { kind: MENTION_KIND.SECTION, taskId: linked.taskId, anchor },
    linked.place,
  );
  return <UnitLinkButton link={link} tabbable={tabbable} />;
}

/** The title's Copy link button, copying the plan's link as the plan's own menu does. */
function TitleLink({
  linked,
  tabbable,
}: {
  linked: LinkedTask;
  tabbable: boolean;
}): React.JSX.Element {
  const link = encodeMention({ kind: MENTION_KIND.TASK, taskId: linked.taskId }, linked.place);
  return <UnitLinkButton link={link} tabbable={tabbable} />;
}

/**
 * A unit's words with the plan's open comments on them marked, the open one
 * and the one being started among them, the same marks while none of them
 * changes, so the unit's words are not parsed again for nothing.
 */
function useCommentMarks(
  section: PlanSection | undefined,
  threads: readonly PlanCommentThread[] | undefined,
  planText: string | undefined,
): MarkdownEdit | undefined {
  const { active, pending } = useCommentFocus();
  return useMemo(() => {
    if (threads === undefined || section === undefined) return undefined;
    const spans = commentSpansIn(threads, section, active, pending, planText);
    if (spans.length === 0) return undefined;
    const marks = spans.map((span) => ({
      from: span.from,
      to: span.to,
      kind: MARKDOWN_MARK.COMMENT,
      thread: span.thread,
      active: span.active,
      block: span.block,
    }));
    return { marks };
  }, [section, threads, active, pending, planText]);
}

/** Whether two views of a unit draw the same, as each save cuts the text afresh. */
function sameView(left: UnitView, right: UnitView): boolean {
  return left.id === right.id && left.heading === right.heading && left.words === right.words;
}

/** Whether two places of a unit's words in the plan's text are one, as the text cut again on each save makes each afresh. */
function sameSection(left: PlanSection | undefined, right: PlanSection | undefined): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return (
    left.heading === right.heading &&
    left.text === right.text &&
    left.from === right.from &&
    left.to === right.to
  );
}

/** What one section of the text is drawn from. */
interface DocumentUnitProps {
  view: UnitView;
  /** Where the unit's words stand in the plan's text, which marks the comments on them; none off a page that draws comments. */
  section: PlanSection | undefined;
  marks: SectionMarks;
  /** Draws the plan's mentions as chips; links are drawn as words without it. */
  link: LinkDrawer | undefined;
  /** The task whose sections have links, which each section's ⋯ copies; none off a task's own page. */
  linked: LinkedTask | undefined;
  /** The section's anchor, empty where its heading spells none. */
  anchor: string;
  /** Whether its ⋯ is a Tab stop: beside the document's one, its section's block, or on a document that cannot be edited. */
  entry: boolean;
  /** Ticks or clears a task item pressed, offsets in the unit's words; every checkbox is read-only without it. */
  onTask?: MarkdownTaskToggler | undefined;
  /** The plan's comment threads, which mark its words; none off a page that reads them. */
  threads: readonly PlanCommentThread[] | undefined;
  /** The plan's text as saved, which a thread being started is laid over; none while no thread is being started. */
  planText: string | undefined;
}

/**
 * Whether a section is drawn as it was: its view and its place in the text
 * by what they say, since each is made afresh on every save, and the rest by
 * identity, which the document holds steady.
 */
function sameUnit(left: DocumentUnitProps, right: DocumentUnitProps): boolean {
  return (
    sameView(left.view, right.view) &&
    sameSection(left.section, right.section) &&
    left.marks === right.marks &&
    left.link === right.link &&
    left.linked === right.linked &&
    left.anchor === right.anchor &&
    left.entry === right.entry &&
    left.onTask === right.onTask &&
    left.threads === right.threads &&
    left.planText === right.planText
  );
}

/**
 * One section of the text, tinted where it changed since the last look,
 * and carrying the byline of the save that last changed it, each by its
 * heading. Note that it is drawn again only when its own words or marks
 * change (`sameUnit`), because drawing it parses its Markdown, and every
 * save hands every section over afresh.
 */
const DocumentUnit = memo(function DocumentUnit({
  view,
  section,
  marks,
  link,
  linked,
  anchor,
  entry,
  onTask,
  threads,
  planText,
}: DocumentUnitProps): React.JSX.Element {
  const changed = marks.changed.has(view.heading);
  const openLink = useOpenLink();
  const picture = usePlanPictureDrawer();
  const edit = useCommentMarks(section, threads, planText);
  const drawn = (
    <MarkdownMessage
      words={view.words}
      className={unitClass(changed)}
      edit={edit}
      link={link}
      openLink={openLink}
      diagrams
      picture={picture}
      onTask={onTask}
    />
  );
  const menu =
    linked === undefined || anchor === "" ? null : (
      <SectionLink linked={linked} anchor={anchor} tabbable={entry} />
    );
  return attributed(drawn, bylineOf(marks, view.heading), menu);
}, sameUnit);

/** How the plan's sections at rest change a date written in them: the plan's text, where a section's words stand in it, and the save of the text written anew. */
interface PlanDates {
  /** The task the page draws now, which a page handed another task without remounting changes. */
  readonly taskId: () => string;
  /** The plan's text as it stands. */
  readonly text: () => string;
  /** Where a section's words start in the text; none while the editor is open. */
  readonly from: (section: number) => number | undefined;
  readonly write: (value: string, base: string) => void;
}

/**
 * A section's words at rest, whose date chips open the picker of the
 * plan's room (`words-dates.tsx`) and save the plan with the date written
 * anew, where the plan takes a change; their chips open nothing elsewhere.
 * Note that the door stands across draws, so a section is not drawn again
 * for a new one.
 */
function SectionDates({
  section,
  dates,
  children,
}: {
  section: number;
  dates: PlanDates | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  const open = useWordsDatePicker();
  const door = useMemo<WordsDates | undefined>(() => {
    if (open === undefined || dates === undefined) return undefined;
    return {
      pick: (written, chip) => {
        // Note that the chip's link is placed in its section's words, which start where the section does in the plan's text.
        const from = dates.from(section);
        if (from === undefined) return;
        const at = { from: from + written.at.from, to: from + written.at.to };
        // Note that the date is written only into the plan it was picked on, so a page handed another task while the picker stands writes nothing.
        const picked = dates.taskId();
        const text = () => (dates.taskId() === picked ? dates.text() : undefined);
        wordsDatesDoor(open, text, dates.write).pick({ ...written, at }, chip);
      },
    };
  }, [open, dates, section]);
  return <WordsDatesContext.Provider value={door}>{children}</WordsDatesContext.Provider>;
}

/** A plan's body, in the plan's type at its page's measure: the column its head and its blocks stand in. */
function PlanBodyColumn({
  ref,
  children,
}: {
  ref?: React.Ref<HTMLDivElement> | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div ref={ref} className={BODY_CLASS}>
      {children}
    </div>
  );
}

/**
 * The open task's one rename door as its title reads it (`desktop-tasks.tsx`):
 * how many times Rename was asked for, each putting the caret in the title,
 * the name a refused rename asked for, which the title goes on drawing until
 * the next, and how the title's ⋯ asks.
 */
export interface TitleRename {
  readonly asks: number;
  readonly asked: string | undefined;
  readonly onBegin: () => void;
}

/**
 * The task's document: its name as the title over its text. `onShowHistory` opens the plan's version history from the
 * byline's "Edited", on the plan as it stands, and from a section's, on the
 * revision of the save it names. With `onEdit`, the text is edited whole in
 * place, and with `onRename` the title too, its words drawn as the task's
 * name through `onDraftName` as they are typed, and with `rename` the title's ⋯
 * offers Rename through the open task's door; without them the document is
 * drawn read-only. A date chip in an editable plan's words at rest opens
 * its picker where it stands, and a date changed there saves the plan
 * through `onEdit` with the date written anew (`SectionDates`), as a task
 * item's box ticks it. An editable plan opens its text from a press on the
 * panel's empty room, as a document editor's page does (`useTextRoom`): at
 * the end under its last line, or anywhere where it has no text yet, and on
 * the nearest line beside it. `looks` are the sections changed since the developer last
 * looked, which the task's region keeps (`use-task-looks.ts`); without them
 * none are.
 *
 * A memo boundary: the task's page drawn again over the same task and the
 * same doors, as its column's focus, its side panel's width, and the
 * minute's clock draw it, leaves the plan as it was.
 */
export const PlanBody = memo(function PlanBody({
  task,
  onShowHistory,
  onEdit,
  onRename,
  onDraftName = NO_DRAFT,
  rename,
  looks = NO_LOOKS,
  sectionLinks,
  reader = NO_READER,
  agents,
  standing: taskStanding,
  head,
  titleActions = true,
}: {
  task: Task;
  onShowHistory?: ShowHistory;
  onEdit?: PlanEditDoor | undefined;
  /** Renames the task, from its title, answering whether the name was taken. */
  onRename?: ((name: string) => Promise<boolean>) | undefined;
  /** Draws the name typed into the title wherever the task is named, or none once it is left. */
  onDraftName?: ((name: string | undefined) => void) | undefined;
  /** The open task's rename door, whose asks put the caret in the title. */
  rename?: TitleRename | undefined;
  looks?: TaskLooks;
  /** What the task's own page does with its sections' links; without it, sections have none and mentions are words. */
  sectionLinks?: SectionLinks;
  /** Who reads it, whose own edits are named "you"; without it, no edit is. */
  reader?: TaskReader;
  /** The task's coding agents, among which an agent's edit is found and opened; without them, an agent is named alone. */
  agents?: EditAgents;
  /** The task's key over its title and its status and priority chips under it; without it, neither is drawn. */
  standing?: TaskStandingDoor;
  /** What the task's own page draws at the head of its text, under its byline, as its agents; nothing elsewhere. */
  head?: React.ReactNode;
  /** Whether the title draws its ⋯; a phone's task draws none, its header's ⋯ holding all it offers (`task-pane-switcher.tsx`). */
  titleActions?: boolean;
}): React.JSX.Element {
  const { views, sections: textSections } = useDrawnUnits(task);
  const editable = onEdit !== undefined;
  const text = editable ? task.document.body : undefined;
  const editReader = useEditReader(reader);
  // Note that what each section is drawn from is held steady across draws,
  // because a section drawn again parses its Markdown again
  // (`DocumentUnit`), and the page hands its props over afresh on each draw.
  const sectionEdits = task.sectionEdits ?? NO_SECTION_EDITS;
  const agentsControl = agents?.control;
  const openAgent = useSteadyDoor(agents?.onOpen);
  const steadyAgents = useMemo<EditAgents | undefined>(
    () => (agentsControl === undefined ? undefined : { control: agentsControl, onOpen: openAgent }),
    [agentsControl, openAgent],
  );
  const place = useMemo<EditPlace>(
    () => ({ reader: editReader, sections: sectionEdits, agents: steadyAgents }),
    [editReader, sectionEdits, steadyAgents],
  );
  const editing = usePlanEditing(task.id, text, onEdit ?? NO_EDIT, place);
  const showHistory = useSteadyDoor(onShowHistory);
  const marks = useMemo<SectionMarks>(
    () => ({
      edits: new Map(place.sections.map(({ section, ...edit }) => [section, edit])),
      changed: looks.changed,
      place,
      onShowHistory: showHistory,
    }),
    [place, looks.changed, showHistory],
  );
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  // A link in the plan's words being edited opens, from its right-click, where the plan stands.
  const editedLinks = useEditedLinksHost();
  const bodyHost = useCallback(
    (element: HTMLDivElement | null) => {
      body.current = element;
      editedLinks(element);
    },
    [editedLinks],
  );
  // The open editor's handle, which a comment started on its words is measured through.
  const editorHandle = useRef<PlanEditorHandle | undefined>(undefined);
  const closedOn = useWordsKeptOnClose(task.id, editing.editor !== undefined, body, scroller);
  // A press on the document's empty room opens its text there, at its end
  // where it lands under the last line, or anywhere on a plan with no text
  // yet, which has no section to click into; the open editor's own room
  // moves its caret (`PlanDocumentEditor`).
  useTextRoom({
    text: body,
    box: () => textBoxOf(body.current),
    room: scroller,
    open: false,
    onPlace: editable && editing.editor === undefined ? editing.open : undefined,
  });
  const anchors = sectionAnchors(views.map((view) => view.heading));
  const linkedWorkspace = sectionLinks?.workspace;
  const linked = useMemo<LinkedTask | undefined>(
    () =>
      linkedWorkspace === undefined
        ? undefined
        : { taskId: task.id, place: { workspace: linkedWorkspace, repository: task.repository } },
    [linkedWorkspace, task.id, task.repository],
  );
  const { link, doors: mentionDoors } = useMentionChips(linked, anchors, sectionLinks);
  /** The ticks and dates written from the words at rest, each sent once the one before it settles. */
  const writes = useRef<PlanWrites>({ last: Promise.resolve(KEPT), saved: undefined });

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
      const blocks = [...element.querySelectorAll<HTMLElement>(`.${EDITABLE_BLOCK_CLASS}`)].filter(
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

  // An ask to show a section scrolls the document's own scroller to it, or
  // to the top where the plan no longer holds it.
  const revealed = useRef<number | undefined>(undefined);
  useEffect(() => {
    const reveal = sectionLinks?.reveal;
    const element = scroller.current;
    if (reveal === undefined || element === null || revealed.current === reveal.ask) return;
    revealed.current = reveal.ask;
    const at = reveal.anchor === undefined ? -1 : anchors.indexOf(reveal.anchor);
    const unit =
      at === -1 ? undefined : element.querySelectorAll<HTMLElement>(`.${UNIT_CLASS}`)[at];
    element.scrollTop =
      unit === undefined
        ? 0
        : element.scrollTop +
          unit.getBoundingClientRect().top -
          element.getBoundingClientRect().top -
          revealMargin(element);
    sectionLinks?.onRevealed?.(reveal.ask);
  });

  // The sections as the plan's text holds them, which is where comments are marked and measured.
  // Note that comments are the plan's own page's alone, never a version of it.
  const comments = usePlanCommentsControl();
  const commentsHere =
    comments !== undefined && comments.planId === task.id && sectionLinks !== undefined;
  const drawnSections = commentsHere ? textSections : undefined;
  // The toolbar over the editor's words selected starts a thread on them where the plan's comments are drawn.
  const commentOnWords = useEditorComment(editorHandle);
  const edited = lastEditOf(task);
  // A task item is ticked from the drawn plan while no editor is open, and
  // saved through the editor's own door.
  const cut = editable && editing.editor === undefined ? textSections : [];
  const tickable = (section: number): boolean => cut[section] !== undefined;
  // A tick or a date that did not save goes back, and says so here, since nothing beside the box or the chip does.
  const toast = useToast();
  const sayNotSaved = useCallback(
    (taskId: string, cause: unknown) =>
      toast({
        words: PLAN_NOT_SAVED,
        tone: STATUS_TONE.DANGER,
        hold: TOAST_HOLD.FAILED,
        failure: {
          surface: FAILURE_SURFACE.PLAN_SAVE,
          cause,
          about: { taskId },
        },
      }),
    [toast],
  );
  // The plan as drawn last, which a tick waiting its turn and a date read as the picker closes are written over.
  const latestPlan = useRef({ cut, id: task.id, body: task.document.body, onEdit });
  latestPlan.current = { cut, id: task.id, body: task.document.body, onEdit };
  // Note that ticks are sent one at a time, in the order pressed, each over
  // the text the one before it saved, since that plan may not be drawn yet.
  // A tick is placed by its item's offset and line as drawn at the press, and
  // writes nothing where the text no longer holds that line.
  const tick = (section: number, at: number, ticked: boolean): Promise<boolean> => {
    const unit = tickable(section) ? cut[section] : undefined;
    const item = unit === undefined ? undefined : taskItemAt(unit.text, at);
    const save = onEdit;
    const pressedOn = task.id;
    const queue = writes.current;
    const sent = queuedWrite(queue, () => {
      const now = latestPlan.current;
      if (save === undefined || unit === undefined || item === undefined)
        return notKept(FAILURE_CONDITION.NOT_KEPT);
      if (now.id !== pressedOn) return notKept(FAILURE_CONDITION.NOT_KEPT);
      const base = planTextNow(queue, now);
      const value = taskSet(base, unit.from + at, item.line, ticked);
      if (value === undefined) return notKept(FAILURE_CONDITION.NOT_KEPT);
      if (value === base) return KEPT;
      return savedOver(queue, save, now, { base, value }, value);
    });
    return sent.then((saved) => {
      if (!saved.kept) sayNotSaved(pressedOn, saved.cause);
      return saved.kept;
    });
  };
  const latestTick = useRef(tick);
  latestTick.current = tick;
  // A date changed from the plan at rest is written over the text as it then stands, read as the picker closes.
  const planDates = useMemo<PlanDates | undefined>(
    () =>
      editable
        ? {
            taskId: () => latestPlan.current.id,
            text: () => planTextNow(writes.current, latestPlan.current),
            from: (section) => latestPlan.current.cut[section]?.from,
            write: (value, base) => {
              const { onEdit: save, id: pickedOn } = latestPlan.current;
              if (save === undefined) return;
              const queue = writes.current;
              // Note that a date waits its turn behind the ticks out, and that
              // one saved since the picker read the plan is not under its text,
              // so nothing after it is written over that text. A save not
              // taken leaves the date as it was, as an unticked box flips back, and says so.
              const sent = queuedWrite(queue, () => {
                const now = latestPlan.current;
                if (now.id !== pickedOn) return notKept(FAILURE_CONDITION.NOT_KEPT);
                const kept = planTextNow(queue, now) === base ? value : undefined;
                return savedOver(queue, save, now, { base, value }, kept);
              });
              sent.then((saved) => {
                if (!saved.kept) sayNotSaved(pickedOn, saved.cause);
              });
            },
          }
        : undefined,
    [editable, sayNotSaved],
  );
  // Each section's toggler stands across draws and ticks from the plan as drawn last, so a section is not drawn again for a new one.
  const togglers = useRef(new Map<number, MarkdownTaskToggler>());
  const taskToggler = (section: number): MarkdownTaskToggler | undefined => {
    // Note that a unit with no box has none, so the editor opening and closing leaves it as drawn.
    if (!tickable(section) || !TASK_ITEM_ANYWHERE.test(views[section]?.words ?? "")) {
      return undefined;
    }
    const held = togglers.current.get(section);
    if (held !== undefined) return held;
    const toggler: MarkdownTaskToggler = (at, ticked) => latestTick.current(section, at, ticked);
    togglers.current.set(section, toggler);
    return toggler;
  };
  // The text a thread being started is laid over, handed to the units only while one is, since every unit is drawn again when it changes.
  const { pending } = useCommentFocus();
  const pendingText = pending === undefined ? undefined : task.document.body;
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
        <SectionDates section={section} dates={planDates}>
          <DocumentUnit
            view={view}
            section={drawnSections?.[section]}
            marks={marks}
            link={link}
            linked={linked}
            anchor={anchors[section] ?? ""}
            entry={entry === view.id}
            onTask={taskToggler(section)}
            threads={comments?.threads}
            planText={pendingText}
          />
        </SectionDates>
      </DocumentBlock>
    ) : (
      <DocumentUnit
        key={view.id}
        view={view}
        section={drawnSections?.[section]}
        marks={marks}
        link={link}
        linked={linked}
        anchor={anchors[section] ?? ""}
        threads={comments?.threads}
        planText={pendingText}
        // Note that a document that cannot be edited has no block Tab stop, so each ⋯ is one.
        entry
      />
    ),
  );
  const titled = editable && onRename !== undefined;
  const titleMenu =
    !titleActions || linked === undefined ? null : (
      <TitleLink
        linked={linked}
        // Note that a document that cannot be edited has no block Tab stop, so the button is one.
        tabbable={editable ? entry === EDITOR_PLACE.TITLE : true}
      />
    );
  return (
    <PlanPictures
      taskId={task.id}
      text={task.document.body}
      sectionNote={(heading) => pictureNoteOf(marks, heading)}
    >
      <DocumentScroll ref={scroller}>
        <PlanBodyColumn ref={bodyHost}>
          <WordsDatePickerRoom>
            {taskStanding === undefined ? null : <TaskPath task={task} door={taskStanding} />}
            {titled ? (
              // Keyed by the plan, so words typed for one are saved to it as another opens.
              <EditableTitle
                key={task.id}
                // A refused name stays in the title, beside the refusal, until the next rename.
                name={rename?.asked ?? task.name}
                entry={entry === EDITOR_PLACE.TITLE}
                editing={editing}
                renaming={rename?.asks ?? 0}
                actions={titleMenu}
                onRename={onRename}
                onDraft={onDraftName}
              />
            ) : (
              <TaskTitle name={task.name} actions={titleMenu} />
            )}
            {taskStanding === undefined ? null : (
              <TaskStandingChips
                task={task}
                onSet={taskStanding.onSet}
                relations={taskStanding.relations}
                inSight={taskStanding.inSight}
              />
            )}
            <PlanByline
              task={task}
              edit={edited}
              place={place}
              saves={editing.saves}
              onShowHistory={onShowHistory}
            />
            <ChangedLine looks={looks} marks={marks} />
            {head}
            {editing.editor === undefined ? (
              editable && views.length === 0 ? (
                <EmptyPlanLine onOpen={() => editing.open(PLACEMENT_END)} />
              ) : (
                sections
              )
            ) : (
              <PlanDocumentEditor
                task={task}
                editor={editing.editor}
                editing={editing}
                drawn={sections}
                hostOf={(section) => views[section]?.id ?? EDITOR_PLACE.TITLE}
                mentions={mentionDoors}
                scroller={scroller}
                handle={editorHandle}
                closedOn={closedOn}
                onComment={drawnSections === undefined ? undefined : commentOnWords}
              />
            )}
            {comments === undefined || !commentsHere || drawnSections === undefined ? null : (
              <PlanCommentLayer
                body={body}
                scroller={scroller}
                unitClass={UNIT_CLASS}
                sections={drawnSections}
                text={task.document.body}
                doors={{ control: comments, agents, me: reader.readerId }}
                editor={editing.editor === undefined ? undefined : editorHandle}
              />
            )}
          </WordsDatePickerRoom>
        </PlanBodyColumn>
      </DocumentScroll>
    </PlanPictures>
  );
});
