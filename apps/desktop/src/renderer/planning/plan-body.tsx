import {
  encodeMention,
  MENTION_KIND,
  type MentionLines,
  type MentionPlace,
  type PlanMention,
  sectionAnchors,
} from "@luke/features/mention-link";
import { PLAN_ACTOR, type PlanLastEdit, type Task } from "@luke/features/task-wire";
import { EllipsisIcon } from "@luke/ui";
import { actorName } from "@luke/ui/actor-model";
import { LinkIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActorStack } from "../actor-ref";
import { LINK_COPY, useCopyToast } from "../copy-feedback";
import { ActionMenu, type MenuAction, useActionMenu } from "../desktop/action-menu";
import { type LinkDrawer, MarkdownMessage } from "../markdown-message";
import { Tooltip } from "../tooltip";
import { prefersReducedMotion } from "../use-reduced-motion";
import {
  type EditAgents,
  EditedBy,
  type EditPlace,
  editorsOf,
  type PlanReader,
  useEditReader,
} from "./edit-ref";
import { type MentionDoors, mentionLinkDrawer } from "./mention-chip";
import {
  DOCUMENT_BLOCK_CLASS,
  DocumentBlock,
  EditableTitle,
  PlanDocumentEditor,
} from "./plan-document-editor";
import {
  copyPlanLinkItem,
  markReadItem,
  type ReadMark,
  renamePlanItem,
  versionHistoryItem,
} from "./plan-menu-items";
import { PlanPictures, usePlanPictureDrawer } from "./plan-pictures";
import {
  type ChaseState,
  chaseBehind,
  chaseOpened,
  chaseRetargeted,
  chaseStepped,
  chaseView,
  type UnitView,
} from "./plan-reveal";
import { agoText, useMinute } from "./plan-time";
import { PlanTitle } from "./plan-title";
import { useOpenLink } from "./use-open-link";
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
 * says who last did in one muted line above the document: a member, Luke
 * (the notetaker), or a coding agent, each on their own face hanging their
 * card (`edit-ref.tsx`), whose call it was on where Luke wrote it on one,
 * and how long ago, moved on once a minute. The time opens the plan's
 * version history, where each earlier version is. Each section says the
 * same of the save that last changed it, quietly, while the pointer or the
 * keyboard is on it, leading with the writer's face, and its time opens the
 * version history on the revision that save made. The sections changed since
 * the developer last looked at the plan on this Mac wear a still tint,
 * counted under that line beside a face for each who changed them, until
 * they dismiss them or leave the plan (`use-plan-looks.ts`).
 * The plan's name is drawn as the title over its text (`plan-title.tsx`),
 * and each section is known by its heading, and its link by the heading's
 * anchor (`sectionAnchors`). A Mermaid fence draws as its diagram once Luke
 * has finished typing it (`../plan-diagram.tsx`).
 *
 * On a plan's own page each section has a link: its ⋯, shown while the
 * pointer or the keyboard is on it, copies the section's address
 * (`@luke/features/mention-link`), which a transcript or the plan draws as
 * the section's chip wherever it is pasted, and a mention in the
 * plan's words is drawn as its chip (`mention-chip.tsx`), which opens the
 * section it names. The title has a ⋯ of its own, drawn as a section's is,
 * which copies the plan's link and offers Rename, where the title can be
 * edited, and Version history, where the window opens it
 * (`plan-menu-items.tsx`). Asked to show a section, the document scrolls
 * its own scroller to it, never `scrollIntoView`, which would scroll every box
 * around it too; a section the plan no longer holds leaves it at its top.
 */

/** What a plan's own page does with its sections' links and its mentions: the slug of the workspace its links are written under, what opens the plan or a section a mention names, or a file's tab, and the section it was last asked to show. */
export interface SectionLinks {
  readonly workspace: string;
  readonly onOpen: (mention: PlanMention) => void;
  readonly onOpenFile?: ((path: string, lines: MentionLines | undefined) => void) | undefined;
  readonly reveal: SectionReveal | undefined;
  /** The document showed the section `reveal` asked for, so the ask can be let go. */
  readonly onRevealed?: ((ask: number) => void) | undefined;
}

/** One ask to show a section by its anchor, or the plan's top where it names none; each ask is its own, so the same section asked twice scrolls twice. */
export interface SectionReveal {
  readonly anchor: string | undefined;
  readonly ask: number;
}

/** The plan a page's sections link to, and where its links are written. */
interface LinkedPlan {
  readonly planId: string;
  readonly place: MentionPlace;
}

/** What a section's ⋯ is called. */
const SECTION_MENU_LABEL = "Section actions";

/** What the title's ⋯ is called. */
const TITLE_MENU_LABEL = "Title actions";

/** The room left above a section scrolled to, so its heading does not stand flush against the document's top edge. */
const REVEAL_MARGIN = 16;

/** The room left above a section the scroller reveals: its scroll padding where that is wider, which clears its faded top edge (`scroll-fade`). */
function revealMargin(scroller: HTMLElement): number {
  const padding = Number.parseFloat(getComputedStyle(scroller).scrollPaddingTop);
  return Number.isNaN(padding) ? REVEAL_MARGIN : Math.max(padding, REVEAL_MARGIN);
}

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

/**
 * The plan's last edit: its newest revision, or, from a service before
 * history, the newest save a coding agent made, which was all it could name.
 */
export function lastEditOf(plan: Task): PlanLastEdit | undefined {
  if (plan.lastEdit !== undefined) return plan.lastEdit;
  // The journal is oldest first, so the newest save is its last.
  const journaled = plan.agentEdits?.at(-1);
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
const NO_READER: PlanReader = { readerId: undefined };

/** Whether the reader wrote an edit: theirs where every edit is, as the template's are, or where it names their account. */
function isReader(edit: PlanLastEdit, reader: PlanReader): boolean {
  if (reader.owner !== undefined) return true;
  return reader.readerId !== undefined && edit.by?.userId === reader.readerId;
}

/** Opens the plan's version history on the revision that made the save at a moment, or on the plan as it stands. */
type ShowHistory = (save: number | undefined) => void;

/**
 * How long ago an edit was, in a line naming it, as the press that opens the
 * version history on it where the window offers one, and as words otherwise.
 * `label` is what the press is called. Note that the press stops there,
 * because a click into a section opens its editor.
 */
function EditTime({
  at,
  now,
  label,
  onShow,
}: {
  at: number;
  now: number;
  label: string;
  onShow: (() => void) | undefined;
}): React.JSX.Element {
  const ago = agoText(at, now);
  if (onShow === undefined) return <span>{ago}</span>;
  return (
    <button
      type="button"
      className="plan-edit-link"
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onShow();
      }}
    >
      {ago}
    </button>
  );
}

/**
 * The line over the document: "Edited by [Charles] Charles Pan · 2h ago".
 * The writer hangs their card, and the time opens the plan's history where
 * the window offers it.
 */
function EditedLine({
  edit,
  place,
  onShowHistory,
}: {
  edit: PlanLastEdit;
  place: EditPlace;
  onShowHistory: ShowHistory | undefined;
}): React.JSX.Element {
  const ago = agoText(edit.at, place.now);
  return (
    <p className="plan-edit-note actor-line">
      {edit.actor === PLAN_ACTOR.EARLIER ? "Edited" : "Edited by "}
      <EditedBy edit={edit} place={place} sentence />
      {" · "}
      <EditTime
        at={edit.at}
        now={place.now}
        label={`Edited ${ago}. Show version history`}
        onShow={onShowHistory === undefined ? undefined : () => onShowHistory(undefined)}
      />
    </p>
  );
}

/** How many sections changed since the last look, as the line under "Edited by" counts them, and by whom where any is named. */
function changedLine(count: number, named: boolean): string {
  const sections = `${count} ${count === 1 ? "section" : "sections"}`;
  return `Changed since you last looked · ${sections}${named ? " by " : ""}`;
}

/**
 * The line under "Edited by" while sections changed since the last look
 * stand lit, a face for each who last changed them, with their dismissal.
 * Note that the faces are named in words a screen reader reads, since a
 * facepile is hidden from it.
 */
function ChangedLine({
  looks,
  marks,
}: {
  looks: PlanLooks;
  marks: SectionMarks;
}): React.JSX.Element | null {
  if (looks.changed.size === 0) return null;
  const edits = [...looks.changed].flatMap((heading) => marks.edits.get(heading) ?? []);
  const editors = editorsOf(edits, marks.place);
  return (
    <p className="plan-changed-note">
      <span className="actor-line">
        {changedLine(looks.changed.size, editors.length > 0)}
        {editors.length === 0 ? null : (
          <>
            <ActorStack actors={editors} />
            <span className="visually-hidden">
              {editors.map((actor) => actorName(actor, { sentence: true })).join(", ")}
            </span>
          </>
        )}
      </span>
      <span aria-hidden="true">·</span>
      <button type="button" className="toolbar-button quiet-button" onClick={looks.dismiss}>
        Dismiss
      </button>
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
 * The section's quiet line: who last changed the section under `heading`,
 * on their face, and when, "[Luke] Luke during Charles Pan’s call · 2h ago",
 * shown while the pointer or the keyboard is on it; none where no save has.
 * Where the window offers the version history, the time opens it on the
 * revision that save made.
 */
function bylineOf(marks: SectionMarks, heading: string): React.JSX.Element | null {
  const edit = marks.edits.get(heading);
  if (edit === undefined) return null;
  const { onShowHistory, place } = marks;
  const ago = agoText(edit.at, place.now);
  const named = heading === "" ? `Edited ${ago}` : `${heading}: edited ${ago}`;
  return (
    <span className="plan-unit-byline actor-line">
      {edit.actor === PLAN_ACTOR.EARLIER ? "Edited" : <EditedBy edit={edit} place={place} />}
      {" · "}
      <EditTime
        at={edit.at}
        now={place.now}
        label={`${named}. Show version history`}
        onShow={onShowHistory === undefined ? undefined : () => onShowHistory(edit.at)}
      />
    </span>
  );
}

/** The class every unit of the text wears, one per section in the order the sections stand. */
const UNIT_CLASS = "plan-unit";

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

/** The class of the column the title and the text stand in. */
const BODY_CLASS = "plan-body";

/**
 * Whether a click in the document's scroller landed on its empty room: the
 * scroller itself, or the column around the title, rather than on anything
 * drawn in it, and with no selection made by the press.
 */
function landsOnEmptyRoom(event: React.MouseEvent<HTMLElement>): boolean {
  const { target, currentTarget } = event;
  const selection = window.getSelection();
  if (selection !== null && !selection.isCollapsed) return false;
  if (target === currentTarget) return true;
  return target instanceof Element && target.classList.contains(BODY_CLASS);
}

function opened(plan: Task): Chase {
  const { body } = plan.document;
  return {
    planId: plan.id,
    body,
    lastEditAt: plan.lastEdit?.at,
    state: chaseOpened(body),
  };
}

/**
 * The chase aimed at the plan as handed over now: a new target for the same
 * plan, a fresh start for another. Note that only the reader's own edit lands
 * at once, because a teammate's arrives unseen and types in as Luke's does.
 */
function aimed(chase: Chase, plan: Task, reader: PlanReader): Chase {
  if (chase.planId !== plan.id) return opened(plan);
  const { body } = plan.document;
  // The reader's own edit lands at once: they watched it being typed already.
  const lastEditAt = plan.lastEdit?.at;
  const ownEdit =
    plan.lastEdit !== undefined &&
    plan.lastEdit.actor === PLAN_ACTOR.DEVELOPER &&
    isReader(plan.lastEdit, reader) &&
    lastEditAt !== chase.lastEditAt;
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
function usePlanChase(plan: Task, live: boolean, reader: PlanReader): PlanChase {
  const [chase, setChase] = useState(() => opened(plan));
  let current = chase;
  if (chase.planId !== plan.id || chase.body !== plan.document.body) {
    current = aimed(chase, plan, reader);
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
  if (view.writing) return `${UNIT_CLASS} ${WRITING_CLASS}${lit}`;
  if (view.resting) {
    return `${UNIT_CLASS} ${RESTING_CLASS}${view.fresh ? ` ${FRESH_CLASS}` : ""}${lit}`;
  }
  return view.fresh ? `${UNIT_CLASS} ${FRESH_CLASS}${lit}` : `${UNIT_CLASS}${lit}`;
}

/**
 * What draws the plan's mentions as chips, on a plan's own page: a link
 * whose destination names a mention, whoever wrote it (`linkMention`),
 * drawn against the anchors of the plan's headings as they stand; nothing
 * off a plan's page, where mentions stay words. Note that it is made again
 * only when a heading changes, since every unit's words are drawn again
 * when it is, and that what opening one does is read as it is pressed.
 */
function useMentionChips(
  linked: LinkedPlan | undefined,
  anchors: readonly string[],
  links: SectionLinks | undefined,
): { readonly link: LinkDrawer | undefined; readonly doors: MentionDoors | undefined } {
  const latest = useRef(links);
  latest.current = links;
  const opensFiles = links?.onOpenFile !== undefined;
  const planId = linked?.planId;
  const workspace = linked?.place.workspace ?? "";
  const repository = linked?.place.repository ?? null;
  const anchorKey = anchors.join("\n");
  return useMemo(() => {
    if (planId === undefined) return { link: undefined, doors: undefined };
    const doors: MentionDoors = {
      planId,
      place: { workspace, repository },
      anchors: new Set(anchorKey.split("\n").filter((anchor) => anchor !== "")),
      onOpenPlan: (mention) => latest.current?.onOpen(mention),
      onOpenFile: opensFiles
        ? (path, lines) => latest.current?.onOpenFile?.(path, lines)
        : undefined,
    };
    return { link: mentionLinkDrawer(doors), doors };
  }, [opensFiles, planId, workspace, repository, anchorKey]);
}

/** The door of a document nothing is edited through: every edit answered as unanswered. */
const NO_EDIT: PlanEditDoor = () => Promise.reject(new Error("This plan cannot be edited here."));

/** Where a title's draft goes when nothing else names the plan: nowhere. */
const NO_DRAFT = (_name: string | undefined): void => undefined;

/** A unit drawn with its section's byline, where a save has changed the section, and its ⋯, where it has a link. */
function attributed(
  drawn: React.JSX.Element,
  byline: React.JSX.Element | null,
  menu: React.JSX.Element | null,
): React.JSX.Element {
  if (byline === null && menu === null) return drawn;
  // Note that the byline and the ⋯ share one row, because a row centres the
  // line on the button's box where two separately placed boxes never quite do.
  return (
    <div className="plan-unit-attributed">
      {drawn}
      <div className="plan-unit-row">
        {byline}
        {menu}
      </div>
    </div>
  );
}

/**
 * A unit's ⋯ at its row's end, a section's or the title's: the window's own
 * menu over `items`, shown while the pointer or the keyboard is on its unit.
 */
function UnitMenu({
  label,
  items,
  tabbable,
}: {
  label: string;
  items: readonly MenuAction[];
  /** Whether it is a Tab stop: only beside the document's one, its unit's block. */
  tabbable: boolean;
}): React.JSX.Element {
  const menu = useActionMenu(true);
  const trigger = menu.trigger();
  return (
    <>
      <Tooltip label={label}>
        <button
          type="button"
          className="icon-button plan-unit-more"
          aria-label={label}
          tabIndex={tabbable ? 0 : -1}
          {...trigger}
          onClick={(event) => {
            // Note that the press stops here, because a click into a section opens its editor.
            event.stopPropagation();
            trigger.onClick(event);
          }}
        >
          <EllipsisIcon />
        </button>
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu label={label} menu={menu.drawn} groups={[items]} onClose={menu.close} />
      )}
    </>
  );
}

/** A section's ⋯, holding the one item that copies the section's link. */
function SectionMenu({
  linked,
  anchor,
  tabbable,
}: {
  linked: LinkedPlan;
  anchor: string;
  tabbable: boolean;
}): React.JSX.Element {
  const copy = useCopyToast();
  // Note that the link is the section's bare address, as every Copy link copies, so it pastes into Slack or a pull request as a link rather than as markdown.
  const copyLink = () =>
    copy(
      encodeMention({ kind: MENTION_KIND.SECTION, taskId: linked.planId, anchor }, linked.place),
      LINK_COPY.COPIED,
    );
  const item: MenuAction = {
    label: LINK_COPY.LABEL,
    icon: <LinkIcon aria-hidden="true" />,
    onSelect: copyLink,
  };
  return <UnitMenu label={SECTION_MENU_LABEL} items={[item]} tabbable={tabbable} />;
}

/**
 * The title's ⋯, drawn as a section's is: Copy link, the plan's, as the plan's
 * own ⋯ menu offers it, then Mark as unread or read where the window keeps
 * the plan's looks, Rename where the title can be edited, and Version
 * history where the window opens it, and nothing more, since the plan's
 * menu holds the rest.
 */
function TitleMenu({
  linked,
  tabbable,
  readMark,
  onRename,
  onShowHistory,
}: {
  linked: LinkedPlan;
  tabbable: boolean;
  readMark: ReadMark | undefined;
  onRename: (() => void) | undefined;
  onShowHistory: ShowHistory | undefined;
}): React.JSX.Element {
  const copy = useCopyToast();
  const items = [
    copyPlanLinkItem(copy, linked.planId, linked.place),
    ...(readMark === undefined ? [] : [markReadItem(readMark)]),
    ...(onRename === undefined ? [] : [renamePlanItem(onRename)]),
    ...(onShowHistory === undefined ? [] : [versionHistoryItem(() => onShowHistory(undefined))]),
  ];
  return <UnitMenu label={TITLE_MENU_LABEL} items={items} tabbable={tabbable} />;
}

/**
 * One section of the text, drawn as the chase has it, tinted where it
 * changed since the last look, and carrying the byline of the save that
 * last changed it, each by its heading.
 */
function DocumentUnit({
  view,
  marks,
  link,
  linked,
  anchor,
  entry,
}: {
  view: UnitView;
  marks: SectionMarks;
  /** Draws the plan's mentions as chips; links are drawn as words without it. */
  link: LinkDrawer | undefined;
  /** The plan whose sections have links, which each section's ⋯ copies; none off a plan's own page. */
  linked: LinkedPlan | undefined;
  /** The section's anchor, empty where its heading spells none. */
  anchor: string;
  /** Whether its ⋯ is a Tab stop: beside the document's one, its section's block, or on a document that cannot be edited. */
  entry: boolean;
}): React.JSX.Element {
  const changed = marks.changed.has(view.heading);
  const openLink = useOpenLink();
  const picture = usePlanPictureDrawer();
  const drawn = (
    <MarkdownMessage
      words={view.words}
      className={unitClass(view, changed)}
      edit={view.edit}
      link={link}
      openLink={openLink}
      diagrams
      picture={picture}
    />
  );
  const menu =
    linked === undefined || anchor === "" ? null : (
      <SectionMenu linked={linked} anchor={anchor} tabbable={entry} />
    );
  return attributed(drawn, bylineOf(marks, view.heading), menu);
}

/**
 * The plan's document: its name as the title over its text. `live` is the
 * plan's call in progress, which keeps the caret waiting where the typing
 * last stopped; `onShowHistory` opens the plan's version history from the
 * "Edited by" line, on the plan as it stands, and from a section's, on the
 * revision of the save it names. With `onEdit`, the text is edited whole in
 * place, and with `onRename` the title too, its words drawn as the plan's
 * name through `onDraftName` as they are typed; without them the document is
 * drawn read-only. An editable plan with no text yet opens it, the caret at
 * its start, from a click anywhere on the panel's empty room, since it has no
 * section to click into. With `page` the document is drawn as a Settings page,
 * as the plan template is: the page's actions end the title's line, and the
 * "Edited by" line and the page's note stand under the title. `looks` are the sections changed since the developer last
 * looked, which the plan's region keeps (`use-plan-looks.ts`); without them
 * none are. `crumb`, where given, stands over the "Edited by" line and
 * says where the plan lives (`plan-crumb.tsx`). `readMark` is whether the
 * plan is marked unread, which the title's ⋯ offers to flip.
 */
export function PlanBody({
  plan,
  live,
  onShowHistory,
  onEdit,
  onRename,
  onDraftName = NO_DRAFT,
  looks = NO_LOOKS,
  readMark,
  page,
  sectionLinks,
  reader = NO_READER,
  agents,
  crumb,
}: {
  plan: Task;
  live: boolean;
  onShowHistory?: ShowHistory;
  onEdit?: PlanEditDoor;
  /** Renames the plan, from its title, answering whether the name was taken. */
  onRename?: (name: string) => Promise<boolean>;
  /** Draws the name typed into the title wherever the plan is named, or none once it is left. */
  onDraftName?: (name: string | undefined) => void;
  looks?: PlanLooks;
  /** Whether the plan is marked unread, and the mark the title's ⋯ sets; without it, the ⋯ offers none. */
  readMark?: ReadMark;
  /** The Settings page the document is drawn as: its actions and its note. */
  page?: { actions: React.ReactNode; note: React.ReactNode };
  /** What the plan's own page does with its sections' links; without it, sections have none and mentions are words. */
  sectionLinks?: SectionLinks;
  /** Who reads it, whose own edits are named "you"; without it, no edit is. */
  reader?: PlanReader;
  /** The plan's coding agents, among which an agent's edit is found and opened; without them, an agent is named alone. */
  agents?: EditAgents;
  /** Where the plan lives and who can edit it, over the "Edited by" line; a Settings page draws none. */
  crumb?: React.ReactNode;
}): React.JSX.Element {
  const { views, behind, jumps } = usePlanChase(plan, live, reader);
  const editable = onEdit !== undefined;
  const text = editable ? plan.document.body : undefined;
  const editing = usePlanEditing(plan.id, text, onEdit ?? NO_EDIT);
  const editReader = useEditReader(reader);
  const now = useMinute();
  const place: EditPlace = { reader: editReader, sections: plan.sectionEdits ?? [], agents, now };
  const marks: SectionMarks = {
    edits: new Map(place.sections.map(({ section, ...edit }) => [section, edit])),
    changed: looks.changed,
    place,
    onShowHistory,
  };
  const scroller = useRef<HTMLDivElement>(null);
  // How many times Rename was chosen from the title's ⋯, each putting the caret in the title.
  const [renaming, setRenaming] = useState(0);
  const anchors = sectionAnchors(views.map((view) => view.heading));
  const linked: LinkedPlan | undefined =
    sectionLinks === undefined
      ? undefined
      : {
          planId: plan.id,
          place: { workspace: sectionLinks.workspace, repository: plan.repository },
        };
  const { link, doors: mentionDoors } = useMentionChips(linked, anchors, sectionLinks);
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

  // An ask to show a section scrolls the document's own scroller to it, or
  // to the top where the plan no longer holds it, and stops the caret being
  // followed away from where the developer asked to be.
  const revealed = useRef<number | undefined>(undefined);
  useEffect(() => {
    const reveal = sectionLinks?.reveal;
    const element = scroller.current;
    if (reveal === undefined || element === null || revealed.current === reveal.ask) return;
    revealed.current = reveal.ask;
    scrolledAway.current = true;
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
        <DocumentUnit
          view={view}
          marks={marks}
          link={link}
          linked={linked}
          anchor={anchors[section] ?? ""}
          entry={entry === view.id}
        />
      </DocumentBlock>
    ) : (
      <DocumentUnit
        key={view.id}
        view={view}
        marks={marks}
        link={link}
        linked={linked}
        anchor={anchors[section] ?? ""}
        // Note that a document that cannot be edited has no block Tab stop, so each ⋯ is one.
        entry
      />
    ),
  );
  const editedNote =
    edited === undefined ? null : (
      <EditedLine edit={edited} place={place} onShowHistory={onShowHistory} />
    );
  const titled = editable && onRename !== undefined;
  // An editable plan with no text yet has no section to click into, so a
  // click on the panel's empty room opens the text with the caret at its start.
  const blank = editable && editing.editor === undefined && plan.document.body.trim() === "";
  const titleMenu =
    linked === undefined || page !== undefined ? null : (
      <TitleMenu
        linked={linked}
        // Note that a document that cannot be edited has no block Tab stop, so the ⋯ is one.
        tabbable={editable ? entry === EDITOR_PLACE.TITLE : true}
        readMark={readMark}
        onRename={titled ? () => setRenaming((count) => count + 1) : undefined}
        onShowHistory={onShowHistory}
      />
    );
  return (
    <PlanPictures planId={plan.id} text={plan.document.body}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the click is the pointer's way into an empty plan; the keyboard's is the title's Return or ↓. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard reaches the text through the title, which Tab enters. */}
      <div
        ref={scroller}
        className="plan-document-scroll scroll-fade"
        onClick={
          blank
            ? (event) => {
                if (landsOnEmptyRoom(event)) editing.open();
              }
            : undefined
        }
      >
        {page === undefined ? crumb : null}
        {page === undefined ? editedNote : null}
        <ChangedLine looks={looks} marks={marks} />
        <div className={BODY_CLASS}>
          {titled ? (
            attributed(
              // Keyed by the plan, so words typed for one are saved to it as another opens.
              <EditableTitle
                key={plan.id}
                name={plan.name}
                entry={entry === EDITOR_PLACE.TITLE}
                editing={editing}
                renaming={renaming}
                onRename={onRename}
                onDraft={onDraftName}
              />,
              null,
              titleMenu,
            )
          ) : page === undefined ? (
            attributed(<PlanTitle name={plan.name} />, null, titleMenu)
          ) : (
            <header className="plan-page-head">
              <div className="plan-title-line">
                <PlanTitle name={plan.name} />
                {page.actions}
              </div>
              {editedNote}
              {page.note}
            </header>
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
              mentions={mentionDoors}
            />
          )}
        </div>
      </div>
    </PlanPictures>
  );
}
