import type { DescriptionCommentThread } from "@repo/features/description-comment-wire";
import { type DescriptionSection, descriptionSections } from "@repo/features/description-document";
import { LINK_PLACE, linkOf, taskLinkStep } from "@repo/features/link-grammar";
import {
  type DescriptionMention,
  type MentionLines,
  type MentionPlace,
  sectionAnchors,
} from "@repo/features/mention-link";
import { FAILURE_CONDITION, FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  DESCRIPTION_ACTOR,
  type DescriptionLastEdit,
  type DescriptionSectionEdit,
  type Task,
} from "@repo/features/task-wire";
import { agoText, momentText, sinceText } from "@repo/features/time-format";
import { EXPERIMENT } from "@repo/settings";
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
} from "@repo/ui";
import { actorName } from "@repo/ui/actor-model";
import { commentSpansIn, useDescriptionCommentsControl } from "@repo/ui/description-comments";
import { GLYPH } from "@repo/ui/icons";
import { type MarkdownTaskBox, TaskBox, type TaskBoxItem } from "@repo/ui/markdown";
import { ReplayMask, ReplayUnmask } from "@repo/ui/session-replay-marks";
import { useMutation, useQuery } from "@tanstack/react-query";
import { diffArrays } from "diff";
import {
  Fragment,
  memo,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { KEPT, type Kept, notKept } from "../act.js";
import { ActorStack } from "../actor-ref.js";
import { usePrefetchEditorBundle } from "../bundle-loader.js";
import { LINK_COPY, useCopyToast } from "../copy-feedback.js";
import {
  DESCRIPTION_PLACEHOLDER,
  type DescriptionEditorHandle,
  PLACEMENT_END,
} from "../description-editor/contract.js";
import { VERSION_HISTORY } from "../desktop/pages-on-demand.js";
import { useEditedLinksHost } from "../link-menu.js";
import {
  type LinkDrawer,
  MARKDOWN_MARK,
  type MarkdownEdit,
  MarkdownMessage,
} from "../markdown-message.js";
import { useCreator } from "../member-directory.js";
import { useSteadyDoor } from "../steady-door.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { appStateQuery, selectExperiment } from "../use-app-state.js";
import {
  CommentsToggle,
  DescriptionCommentLayer,
  useCommentFocus,
  useEditorComment,
} from "./description-comments.js";
import {
  DescriptionDocumentEditor,
  DocumentBlock,
  EditableTitle,
  textBoxOf,
  useTextRoom,
  useWordsKeptOnClose,
} from "./description-document-editor.js";
import {
  type DescriptionEditMutation,
  type DescriptionEditSend,
  descriptionAtRestMutation,
  descriptionEditMutation,
} from "./description-edit-mutation.js";
import { DescriptionPictures, useDescriptionPictureDrawer } from "./description-pictures.js";
import {
  UNIT_ATTRIBUTED_CLASS,
  UNIT_BYLINE_CLASS,
  UNIT_MORE_CLASS,
} from "./description-unit-look.js";
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
import { TaskPath, TaskStandingChips, type TaskStandingDoor } from "./task-standing.js";
import { TaskTitle } from "./task-title.js";
import { EDITOR_PLACE, useDescriptionEditing } from "./use-description-editing.js";
import { useOpenLink } from "./use-open-link.js";
import { NO_LOOKS, type TaskLooks } from "./use-task-looks.js";
import { useTaskMaker } from "./use-task-origin.js";
import {
  useWordsDatePicker,
  WordsDatePickerRoom,
  type WordsDates,
  WordsDatesContext,
  wordsDatesDoor,
} from "./words-dates.js";

export interface SectionLinks {
  readonly workspace: string;
  readonly onOpen: (mention: DescriptionMention) => void;
  readonly onOpenFile?: ((path: string, lines: MentionLines | undefined) => void) | undefined;
  readonly reveal: SectionReveal | undefined;
  readonly onRevealed?: ((ask: number) => void) | undefined;
  readonly agentOf?: MentionDoors["agentOf"];
  readonly pullRequestOf?: MentionDoors["pullRequestOf"];
}

export interface SectionReveal {
  readonly anchor: string | undefined;
  readonly ask: number;
}

interface LinkedTask {
  readonly taskId: string;
  readonly step: string;
  readonly place: MentionPlace;
}

const REVEAL_MARGIN = 16;

function revealMargin(scroller: HTMLElement): number {
  const padding = Number.parseFloat(getComputedStyle(scroller).scrollPaddingTop);
  return Number.isNaN(padding) ? REVEAL_MARGIN : Math.max(padding, REVEAL_MARGIN);
}

interface UnitView {
  readonly id: number;
  readonly heading: string;
  readonly words: string;
}

interface DrawnUnits {
  readonly taskId: string;
  readonly body: string;
  readonly sections: readonly DescriptionSection[];
  readonly views: readonly UnitView[];
  readonly nextId: number;
}

export function lastEditOf(task: Task): DescriptionLastEdit | undefined {
  if (task.lastEdit !== undefined) return task.lastEdit;
  const journaled = task.agentEdits?.at(-1);
  if (journaled === undefined) return undefined;
  return {
    actor: DESCRIPTION_ACTOR.AGENT,
    label: journaled.label,
    agentId: journaled.agentId,
    at: journaled.at,
    duringCall: false,
  };
}

const NO_READER: TaskReader = { readerId: undefined };

type ShowHistory = (save: number | undefined) => void;

function EditTime({
  at,
  label,
  onShow,
  short = false,
  whole = false,
}: {
  at: number;
  label: (ago: string) => string;
  onShow: (() => void) | undefined;
  short?: boolean;
  whole?: boolean;
}): React.JSX.Element {
  const now = useMinute();
  const words = short ? sinceText(at, now, { year: false }) : agoText(at, now);
  const time =
    onShow === undefined ? (
      <span>{words}</span>
    ) : (
      <TextButton
        lines={whole ? TEXT_BUTTON_LINES.WHOLE : TEXT_BUTTON_LINES.ONE}
        aria-label={label(agoText(at, now))}
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

function EmptyDescriptionLine({ onOpen }: { onOpen: () => void }): React.JSX.Element {
  const prefetchEditorBundle = usePrefetchEditorBundle();
  return (
    <Text tone={TEXT_TONE.MUTED}>
      <TextButton
        onPointerEnter={prefetchEditorBundle}
        onFocus={prefetchEditorBundle}
        onClick={onOpen}
      >
        <ReplayUnmask>{DESCRIPTION_PLACEHOLDER}</ReplayUnmask>
      </TextButton>
    </Text>
  );
}

const editedLabel = (ago: string): string => `Edited ${ago}. Show version history`;

function Ago({ at }: { at: number }): React.JSX.Element {
  return <span>{agoText(at, useMinute())}</span>;
}

function DescriptionByline({
  task,
  edit,
  place,
  saves,
  onShowHistory,
  comments,
}: {
  task: Task;
  edit: DescriptionLastEdit | undefined;
  place: EditPlace;
  saves: number | undefined;
  onShowHistory: ShowHistory | undefined;
  comments: boolean;
}): React.JSX.Element {
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
      saved={saves === undefined ? undefined : <SavedTick saves={saves} />}
      end={comments ? <CommentsToggle /> : undefined}
    />
  );
}

function changedLine(count: number, named: boolean): string {
  const sections = `${count} ${count === 1 ? "section" : "sections"}`;
  return `Changed since you last looked · ${sections}${named ? " by " : ""}`;
}

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
  return (
    <p className="description-changed-note -mt-ui-6 mb-ui-12 mx-0 flex h-description-changed-note items-center gap-item-gap text-caption text-muted-foreground">
      <ReplayUnmask>
        <span className="actor-line">
          {changedLine(looks.changed.size, editors.length > 0)}
          {editors.length === 0 ? null : (
            <ReplayMask>
              <ActorStack actors={editors} />
              <VisuallyHidden>
                {editors.map((actor) => actorName(actor, { sentence: true })).join(", ")}
              </VisuallyHidden>
            </ReplayMask>
          )}
        </span>
        <span aria-hidden="true">·</span>
        <Button onClick={looks.dismiss}>Dismiss</Button>
      </ReplayUnmask>
    </p>
  );
}

interface SectionMarks {
  readonly edits: ReadonlyMap<string, DescriptionLastEdit>;
  readonly changed: ReadonlySet<string>;
  readonly place: EditPlace;
  readonly onShowHistory: ShowHistory | undefined;
}

function bylineOf(marks: SectionMarks, heading: string): React.JSX.Element | null {
  if (heading === "") return null;
  const edit = marks.edits.get(heading);
  if (edit === undefined) return null;
  const { onShowHistory, place } = marks;
  return (
    <span className={UNIT_BYLINE_CLASS}>
      {edit.actor === DESCRIPTION_ACTOR.EARLIER ? (
        <ReplayUnmask>Edited</ReplayUnmask>
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

function pictureNoteOf(marks: SectionMarks, heading: string): React.JSX.Element | null {
  const edit = marks.edits.get(heading);
  if (edit === undefined) return null;
  const { place } = marks;
  return (
    <span className="actor-line">
      {edit.actor === DESCRIPTION_ACTOR.EARLIER ? "Edited" : "Edited by "}
      <EditedBy edit={edit} place={place} sentence />
      {" · "}
      <Ago at={edit.at} />
    </span>
  );
}

const UNIT_CLASS = "description-unit";

const CHANGED_CLASS =
  "description-changed relative isolate after:pointer-events-none after:absolute after:-inset-x-ui-6 after:-inset-y-ui-2 after:-z-1 after:rounded-ui-6 after:bg-[linear-gradient(theme(--color-description-changed),theme(--color-description-changed))]";

const BODY_CLASS = "description-body";

const HEAD_KEY = "head";

function unitsAfter(
  previous: readonly UnitView[],
  sections: readonly DescriptionSection[],
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

function drawnUnits(task: Task, held: DrawnUnits | undefined): DrawnUnits {
  const { body } = task.document;
  const sections = descriptionSections(body);
  const same = held?.taskId === task.id ? held : undefined;
  const { views, nextId } = unitsAfter(same?.views ?? [], sections, same?.nextId ?? 0);
  return { taskId: task.id, body, sections, views, nextId };
}

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

function useMentionChips(
  linked: LinkedTask | undefined,
  anchors: readonly string[],
  links: SectionLinks | undefined,
): { readonly link: LinkDrawer | undefined; readonly doors: MentionDoors | undefined } {
  const latest = useRef(links);
  latest.current = links;
  const opensFiles = links?.onOpenFile !== undefined;
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

const NO_EDIT: DescriptionEditSend = () =>
  Promise.reject(new Error("This description cannot be edited here."));

const NO_DRAFT = (_name: string | undefined): void => undefined;

const TASK_ITEM = /^(?:[-*+]|\d{1,9}[.)])[ \t]+\[([ \txX])\]/u;

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

function taskSet(text: string, at: number, line: string, ticked: boolean): string | undefined {
  const item = taskItemAt(text, at);
  if (item === undefined || item.line !== line) return undefined;
  return `${text.slice(0, item.box)}${ticked ? "x" : " "}${text.slice(item.box + 1)}`;
}

interface DescriptionWrites {
  saved: { readonly taskId: string; readonly over: string; readonly text: string } | undefined;
}

interface DrawnDescription {
  readonly id: string;
  readonly body: string;
}

function descriptionTextNow(writes: DescriptionWrites, drawn: DrawnDescription): string {
  const saved = writes.saved;
  return saved !== undefined && saved.taskId === drawn.id && saved.over === drawn.body
    ? saved.text
    : drawn.body;
}

function savedOver(
  writes: DescriptionWrites,
  save: DescriptionEditSend,
  drawn: DrawnDescription,
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

type DescriptionTick = ReturnType<typeof descriptionAtRestMutation<boolean, boolean>>;

function DescriptionTaskBox({
  item,
  tick,
}: {
  item: TaskBoxItem;
  tick: (at: number) => DescriptionTick;
}): React.JSX.Element {
  const { mutate, isPending, data, variables } = useMutation(tick(item.at));
  const asked = isPending || data === true ? variables : undefined;
  return (
    <TaskBox
      label={item.label}
      checked={item.checked}
      write={{ run: (ticked) => mutate(ticked), asked }}
    />
  );
}

const DESCRIPTION_NOT_SAVED = "The description could not be saved.";

const TASK_ITEM_ANYWHERE = /(?:[-*+]|\d{1,9}[.)])[ \t]+\[[ \txX]\]/u;

const NO_SECTION_EDITS: readonly DescriptionSectionEdit[] = [];

function attributed(
  drawn: React.JSX.Element,
  byline: React.JSX.Element | null,
  menu: React.JSX.Element | null,
): React.JSX.Element {
  if (byline === null && menu === null) return drawn;
  return (
    <div className={UNIT_ATTRIBUTED_CLASS}>
      {drawn}
      <div className="description-unit-row pointer-events-none absolute top-0 -right-ui-6 flex h-control w-description-unit-row items-center justify-end gap-tight-gap">
        {byline}
        {menu}
      </div>
    </div>
  );
}

function UnitLinkButton({
  link,
  label,
  tabbable,
}: {
  link: string;
  label: string;
  tabbable: boolean;
}): React.JSX.Element {
  const copy = useCopyToast();
  return (
    <span className={UNIT_MORE_CLASS}>
      <Tooltip label={LINK_COPY.LABEL}>
        <IconButton
          icon={<GLYPH.LINK />}
          label={label}
          tabbable={tabbable}
          onClick={(event) => {
            event.stopPropagation();
            copy(link, LINK_COPY.COPIED);
          }}
        />
      </Tooltip>
    </span>
  );
}

function SectionLink({
  linked,
  anchor,
  heading,
  tabbable,
}: {
  linked: LinkedTask;
  anchor: string;
  heading: string;
  tabbable: boolean;
}): React.JSX.Element {
  const link = linkOf(
    { kind: LINK_PLACE.SECTION, planId: linked.step, anchor },
    linked.place.workspace,
  );
  return (
    <UnitLinkButton link={link} label={`${LINK_COPY.LABEL} to ${heading}`} tabbable={tabbable} />
  );
}

function TitleLink({
  linked,
  tabbable,
}: {
  linked: LinkedTask;
  tabbable: boolean;
}): React.JSX.Element {
  const link = linkOf({ kind: LINK_PLACE.TASK, planId: linked.step }, linked.place.workspace);
  return <UnitLinkButton link={link} label={LINK_COPY.LABEL} tabbable={tabbable} />;
}

function useCommentMarks(
  section: DescriptionSection | undefined,
  threads: readonly DescriptionCommentThread[] | undefined,
  descriptionText: string | undefined,
): MarkdownEdit | undefined {
  const { active, pending } = useCommentFocus();
  return useMemo(() => {
    if (threads === undefined || section === undefined) return undefined;
    const spans = commentSpansIn(threads, section, active, pending, descriptionText);
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
  }, [section, threads, active, pending, descriptionText]);
}

function sameView(left: UnitView, right: UnitView): boolean {
  return left.id === right.id && left.heading === right.heading && left.words === right.words;
}

function sameSection(
  left: DescriptionSection | undefined,
  right: DescriptionSection | undefined,
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return (
    left.heading === right.heading &&
    left.text === right.text &&
    left.from === right.from &&
    left.to === right.to
  );
}

interface DocumentUnitProps {
  view: UnitView;
  section: DescriptionSection | undefined;
  marks: SectionMarks;
  link: LinkDrawer | undefined;
  linked: LinkedTask | undefined;
  anchor: string;
  entry: boolean;
  taskBox?: MarkdownTaskBox | undefined;
  threads: readonly DescriptionCommentThread[] | undefined;
  descriptionText: string | undefined;
}

function sameUnit(left: DocumentUnitProps, right: DocumentUnitProps): boolean {
  return (
    sameView(left.view, right.view) &&
    sameSection(left.section, right.section) &&
    left.marks === right.marks &&
    left.link === right.link &&
    left.linked === right.linked &&
    left.anchor === right.anchor &&
    left.entry === right.entry &&
    left.taskBox === right.taskBox &&
    left.threads === right.threads &&
    left.descriptionText === right.descriptionText
  );
}

const DocumentUnit = memo(function DocumentUnit({
  view,
  section,
  marks,
  link,
  linked,
  anchor,
  entry,
  taskBox,
  threads,
  descriptionText,
}: DocumentUnitProps): React.JSX.Element {
  const changed = marks.changed.has(view.heading);
  const openLink = useOpenLink();
  const picture = useDescriptionPictureDrawer();
  const edit = useCommentMarks(section, threads, descriptionText);
  const drawn = (
    <MarkdownMessage
      words={view.words}
      className={unitClass(changed)}
      edit={edit}
      link={link}
      openLink={openLink}
      diagrams
      picture={picture}
      taskBox={taskBox}
    />
  );
  const menu =
    linked === undefined || anchor === "" ? null : (
      <SectionLink linked={linked} anchor={anchor} heading={view.heading} tabbable={entry} />
    );
  return attributed(drawn, bylineOf(marks, view.heading), menu);
}, sameUnit);

interface DescriptionDates {
  readonly taskId: () => string;
  readonly text: () => string;
  readonly from: (section: number) => number | undefined;
  readonly write: (value: string, base: string) => void;
}

function SectionDates({
  section,
  dates,
  children,
}: {
  section: number;
  dates: DescriptionDates | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  const open = useWordsDatePicker();
  const door = useMemo<WordsDates | undefined>(() => {
    if (open === undefined || dates === undefined) return undefined;
    return {
      pick: (written, chip) => {
        const from = dates.from(section);
        if (from === undefined) return;
        const at = { from: from + written.at.from, to: from + written.at.to };
        const picked = dates.taskId();
        const text = () => (dates.taskId() === picked ? dates.text() : undefined);
        wordsDatesDoor(open, text, dates.write).pick({ ...written, at }, chip);
      },
    };
  }, [open, dates, section]);
  return <WordsDatesContext.Provider value={door}>{children}</WordsDatesContext.Provider>;
}

function DescriptionBodyColumn({
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

export interface DescriptionRoom {
  readonly scroller: RefObject<HTMLElement | null>;
  readonly column: RefObject<HTMLElement | null>;
}

export interface TitleRename {
  readonly asks: number;
  readonly asked: string | undefined;
  readonly onBegin: () => void;
}

export const DescriptionBody = memo(function DescriptionBody({
  task,
  onShowHistory,
  edit,
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
  shown = true,
}: {
  task: Task;
  onShowHistory?: ShowHistory;
  edit?: DescriptionEditMutation | undefined;
  onRename?: ((name: string) => Promise<boolean>) | undefined;
  onDraftName?: ((name: string | undefined) => void) | undefined;
  rename?: TitleRename | undefined;
  looks?: TaskLooks;
  sectionLinks?: SectionLinks;
  reader?: TaskReader;
  agents?: EditAgents;
  standing?: TaskStandingDoor;
  head?: ((room: DescriptionRoom) => React.ReactNode) | undefined;
  titleActions?: boolean;
  shown?: boolean;
}): React.JSX.Element {
  const { views, sections: textSections } = useDrawnUnits(task);
  const documented =
    useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.DESCRIPTIONS) }).data === true;
  const editable = edit !== undefined && documented;
  const text = editable ? task.document.body : undefined;
  const editReader = useEditReader(reader);
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
  const descriptionWrites = edit ?? descriptionEditMutation(task.id, NO_EDIT);
  const editing = useDescriptionEditing(task.id, text, descriptionWrites, place);
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
  const room = useMemo((): DescriptionRoom => ({ scroller, column: body }), []);
  const editedLinks = useEditedLinksHost();
  const bodyHost = useCallback(
    (element: HTMLDivElement | null) => {
      body.current = element;
      editedLinks(element);
    },
    [editedLinks],
  );
  const editorHandle = useRef<DescriptionEditorHandle | undefined>(undefined);
  const closedOn = useWordsKeptOnClose(task.id, editing.editor !== undefined, body, scroller);
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
        : {
            taskId: task.id,
            step: taskLinkStep({ id: task.id, number: task.number }),
            place: { workspace: linkedWorkspace, repository: task.repository },
          },
    [linkedWorkspace, task.id, task.number, task.repository],
  );
  const { link, doors: mentionDoors } = useMentionChips(linked, anchors, sectionLinks);
  const writes = useRef<DescriptionWrites>({ saved: undefined });

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

  const comments = useDescriptionCommentsControl();
  const commentsHere =
    comments !== undefined && comments.planId === task.id && sectionLinks !== undefined;
  const drawnSections = commentsHere ? textSections : undefined;
  const commentOnWords = useEditorComment(editorHandle);
  const edited = lastEditOf(task);
  const cut = editable && editing.editor === undefined ? textSections : [];
  const tickable = (section: number): boolean => cut[section] !== undefined;
  const toast = useToast();
  const sayNotSaved = useCallback(
    (taskId: string, cause: unknown) =>
      toast({
        replayUnmasked: true,
        words: DESCRIPTION_NOT_SAVED,
        tone: STATUS_TONE.DANGER,
        hold: TOAST_HOLD.FAILED,
        failure: {
          surface: FAILURE_SURFACE.DESCRIPTION_SAVE,
          cause,
          about: { taskId },
        },
      }),
    [toast],
  );
  const latestDescription = useRef({
    cut,
    id: task.id,
    body: task.document.body,
    saves: edit !== undefined,
  });
  latestDescription.current = {
    cut,
    id: task.id,
    body: task.document.body,
    saves: edit !== undefined,
  };
  const said = (pickedOn: string) => (saved: Kept) => {
    if (!saved.kept) sayNotSaved(pickedOn, saved.cause);
    return saved.kept;
  };
  const tick = (section: number, at: number): DescriptionTick => {
    const unit = tickable(section) ? cut[section] : undefined;
    const item = unit === undefined ? undefined : taskItemAt(unit.text, at);
    const pressedOn = task.id;
    const queue = writes.current;
    const written = (ticked: boolean, save: DescriptionEditSend): Promise<Kept> | Kept => {
      const now = latestDescription.current;
      if (!now.saves || item === undefined || now.id !== pressedOn)
        return notKept(FAILURE_CONDITION.NOT_KEPT);
      const base = descriptionTextNow(queue, now);
      const from = descriptionSections(base)[section]?.from;
      if (from === undefined) return notKept(FAILURE_CONDITION.NOT_KEPT);
      const value = taskSet(base, from + at, item.line, ticked);
      if (value === undefined) return notKept(FAILURE_CONDITION.NOT_KEPT);
      if (value === base) return KEPT;
      return savedOver(queue, save, now, { base, value }, value);
    };
    return descriptionAtRestMutation(pressedOn, descriptionWrites, (ticked: boolean, save) =>
      Promise.resolve(written(ticked, save)).then(said(pressedOn)),
    );
  };
  const latestTick = useRef(tick);
  latestTick.current = tick;
  const dated = useMutation(
    descriptionAtRestMutation(
      task.id,
      descriptionWrites,
      (
        asked: { readonly value: string; readonly base: string; readonly pickedOn: string },
        save,
      ) => {
        const now = latestDescription.current;
        const queue = writes.current;
        const sent =
          now.id === asked.pickedOn
            ? savedOver(
                queue,
                save,
                now,
                { base: asked.base, value: asked.value },
                descriptionTextNow(queue, now) === asked.base ? asked.value : undefined,
              )
            : Promise.resolve(notKept(FAILURE_CONDITION.NOT_KEPT));
        return sent.then(said(asked.pickedOn));
      },
    ),
  );
  const writeDate = useRef(dated.mutate);
  writeDate.current = dated.mutate;
  const descriptionDates = useMemo<DescriptionDates | undefined>(
    () =>
      editable
        ? {
            taskId: () => latestDescription.current.id,
            text: () => descriptionTextNow(writes.current, latestDescription.current),
            from: (section) => latestDescription.current.cut[section]?.from,
            write: (value, base) => {
              const { saves, id: pickedOn } = latestDescription.current;
              if (saves) writeDate.current({ value, base, pickedOn });
            },
          }
        : undefined,
    [editable],
  );
  const boxes = useRef(new Map<number, MarkdownTaskBox>());
  const taskBox = (section: number): MarkdownTaskBox | undefined => {
    if (!tickable(section) || !TASK_ITEM_ANYWHERE.test(views[section]?.words ?? "")) {
      return undefined;
    }
    const held = boxes.current.get(section);
    if (held !== undefined) return held;
    const tickAt = (at: number) => latestTick.current(section, at);
    const drawBox: MarkdownTaskBox = (item) => <DescriptionTaskBox item={item} tick={tickAt} />;
    boxes.current.set(section, drawBox);
    return drawBox;
  };
  const { pending } = useCommentFocus();
  const pendingText = pending === undefined ? undefined : task.document.body;
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
        <SectionDates section={section} dates={descriptionDates}>
          <DocumentUnit
            view={view}
            section={drawnSections?.[section]}
            marks={marks}
            link={link}
            linked={linked}
            anchor={anchors[section] ?? ""}
            entry={entry === view.id}
            taskBox={taskBox(section)}
            threads={comments?.threads}
            descriptionText={pendingText}
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
        descriptionText={pendingText}
        entry
      />
    ),
  );
  const titled = edit !== undefined && onRename !== undefined;
  const titleMenu =
    !titleActions || linked === undefined ? null : (
      <TitleLink linked={linked} tabbable={editable ? entry === EDITOR_PLACE.TITLE : true} />
    );
  const column = (
    <DocumentScroll ref={scroller}>
      <DescriptionBodyColumn ref={bodyHost}>
        <WordsDatePickerRoom>
          {taskStanding === undefined ? null : <TaskPath task={task} door={taskStanding} />}
          {titled ? (
            <EditableTitle
              key={task.id}
              name={rename?.asked ?? task.name}
              entry={entry === EDITOR_PLACE.TITLE}
              editing={editing}
              alone={!documented}
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
          <DescriptionByline
            task={task}
            edit={documented ? edited : undefined}
            place={place}
            saves={documented ? editing.saves : undefined}
            onShowHistory={onShowHistory}
            comments={documented && commentsHere}
          />
          {documented ? <ChangedLine looks={looks} marks={marks} /> : null}
          <Fragment key={HEAD_KEY}>{head?.(room)}</Fragment>
          {!documented ? null : editing.editor === undefined ? (
            editable && views.length === 0 ? (
              <EmptyDescriptionLine onOpen={() => editing.open(PLACEMENT_END)} />
            ) : (
              sections
            )
          ) : (
            <DescriptionDocumentEditor
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
          {!documented ||
          comments === undefined ||
          !commentsHere ||
          drawnSections === undefined ? null : (
            <DescriptionCommentLayer
              body={body}
              scroller={scroller}
              shown={shown}
              unitClass={UNIT_CLASS}
              sections={drawnSections}
              text={task.document.body}
              doors={{ control: comments, agents, me: reader.readerId }}
              editor={editing.editor === undefined ? undefined : editorHandle}
            />
          )}
        </WordsDatePickerRoom>
      </DescriptionBodyColumn>
    </DocumentScroll>
  );
  return documented ? (
    <DescriptionPictures
      taskId={task.id}
      text={task.document.body}
      sectionNote={(heading) => pictureNoteOf(marks, heading)}
    >
      {column}
    </DescriptionPictures>
  ) : (
    column
  );
});
