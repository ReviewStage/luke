import { useAtomValue } from "@effect/atom-react";
import { decodeMention } from "@luke/features/mention-link";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { ANNOUNCE } from "@luke/ui";
import { AsyncResult } from "effect/reactivity";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useAppCommand } from "../app-commands.js";
import { useSideBundles } from "../bundle-loader.js";
import { DiagramPreview } from "../plan-diagram.js";
import {
  type EditorAnchor,
  type EditorAnchors,
  type EditorDiagram,
  type Finish,
  type HeadingsChange,
  type MentionNode,
  type MentionNodeDoors,
  type PlanEditorHandle,
  type PlanEditorModule,
  type PlanEditorPlacement,
  type PlanEditorProps,
  SLASH_INSERT,
  type SlashBlock,
} from "../plan-editor/contract.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { type OwnBlock, useBlockPicker } from "./block-picker.js";
import type { EditorPictures } from "./editor-pictures.js";
import { type MentionDoors, MentionNodeChip, pastedMentionNode } from "./mention-chip.js";
import { MENTION_MENU_SIDE, type MentionSource, useMentionPicker } from "./mention-picker.js";
import { useSelectionToolbar } from "./selection-toolbar.js";
import { useKnownNames } from "./use-known-names.js";

/**
 * markdown-editor.tsx -- a Markdown document edited in place: the editor bundle's editor on its text, the format toolbar over its selection, the `/` menu under a `/`, and what each document opts into beside them.
 *
 * Every Markdown document the panel edits mounts this one editor: a plan's
 * text (`plan-document-editor.tsx`), and a pull request's description or a
 * review's comment alike. The editor is TipTap, from the editor bundle
 * (`../bundle-loader.ts`); until it has loaded, the document's own drawing
 * stands (`loading`), and where it could not be loaded a note says so.
 * Whatever a document takes, its selected words raise the format toolbar
 * over them (`./selection-toolbar.tsx`), Turn into among it outside a
 * table's cell; a `/` at a line's start or after a space opens the block
 * menu under it (`./block-picker.tsx`); the writing chords are the editor's
 * own; and each block left untouched keeps its exact source
 * (`../plan-editor/document-source.ts`). What a document opts into beside
 * that: its mentions, drawn as their chips, with `@` picking new ones; its
 * pictures; its comment threads' words, carried as they move, and Comment on
 * the toolbar; its sections' placement, the caret opened on a section or on
 * the words a click landed on, and ↑ from the first line leaving the text; a
 * Mermaid block's preview, drawn here as the read view draws it
 * (`../plan-diagram.tsx`), so the editor's bundle carries no Mermaid; and
 * rows of its own blocks in the `/` menu, with rows that do not apply to it
 * dropped. The `/` menu stands aside while the `@` list stands, as the
 * toolbar stands aside for either. The editor stands in a room of its own
 * that the toolbar and the menus float in, under `ph-no-capture`, its words
 * document text the recording masks; focus leaving the room for anywhere
 * but its own toolbar and menus is the document's to hear (`onLeave`). A
 * finish or a leaving waits for a picture still being kept, since only the
 * open editor can lay in its address; it goes once none is.
 */

/** What every editor's room wears: the box the toolbar and the menus over its words are placed in. */
const ROOM_CLASS = "markdown-editor relative";

/** What the room says while the editor's bundle could not be loaded. */
const EDITOR_LOAD_FAILED = "The editor could not be loaded.";

/**
 * What stands under an editor, a failed load or save, or a change made
 * elsewhere and the choice it asks: one wrapping line in the caption role,
 * its presses a control's gap apart. Its margin is its sheet's (tasks.css),
 * because it has to outrank the editor's own gap between its children.
 */
export const EDITOR_NOTE_CLASS =
  "plan-editor-note flex flex-wrap items-center gap-control-gap text-caption text-muted-foreground";

/** A document's mentions in its editor: what they open and where they are written, what the `@` list offers, and how an edit of the document's headings names them anew. */
interface MarkdownEditorMentions {
  readonly doors: MentionDoors;
  /** What the `@` list offers but the document's own words, which the editor reads as they stand. */
  readonly source: Omit<MentionSource, "text">;
  /** A mention named again, its target and its name, where an edit renamed or moved the section it names; none where the document's sections are named by no mention. */
  readonly retarget?:
    | ((target: string, change: HeadingsChange) => MentionNode | undefined)
    | undefined;
}

/** What a document hands its editor: its text, the doors it hears it through, and what it opts into. */
export interface MarkdownEditorProps {
  /** The text the editor opens on. */
  readonly markdown: string;
  /** What the editor's words are named to a reader. */
  readonly label: string;
  /** What the room the editor stands in is named to a reader. */
  readonly roomLabel: string;
  /** What the empty text says until a word is typed. */
  readonly placeholder: string;
  /** What the editor's words wear, as the drawn words wear it, so nothing moves as it opens. */
  readonly className: string;
  /** What the room wears beside its own, for the document's look of it. */
  readonly roomClassName?: string | undefined;
  /** Whether the editor takes the keyboard as it mounts; it does where none is said. */
  readonly focus?: boolean | undefined;
  /** The text as it would be saved now, after each change, and where the comment threads' words stand in it, where the document carries any. */
  readonly onDraft: (markdown: string, anchors?: EditorAnchors) => void;
  /** Esc or ⌘↩, with the section the caret stood in, which a document with no sections need not read, and which of the two it was. */
  readonly onFinish: (section: number, how: Finish) => void;
  /** Focus leaving the room for anywhere but its own toolbar and menus; none where the document stays open. */
  readonly onLeave?: (() => void) | undefined;
  /** Where the mounted editor's handle is kept, for a document that asks it more than its drafts. */
  readonly handle?: RefObject<PlanEditorHandle | undefined> | undefined;
  /** Where the room is kept, for a document that places by it. */
  readonly room?: RefObject<HTMLElement | null> | undefined;
  /** What stands in the room until the editor's bundle has loaded: the document as drawn, so a click's point lands on the same word. */
  readonly loading?: ReactNode;
  /** What the document draws in the room under its editor, a note on its save say. */
  readonly children?: ReactNode;
  /** Where the caret goes as the editor opens; the start of the text where none is given. */
  readonly placement?: PlanEditorPlacement | undefined;
  /** ↑ from the text's first line, to what stands above it; none where nothing does. */
  readonly onLeaveUp?: (() => void) | undefined;
  /** The document's mentions; none where it takes none. */
  readonly mentions?: MarkdownEditorMentions | undefined;
  /** The document's pictures (`useEditorPictures`); none where it takes none. */
  readonly pictures?: EditorPictures | undefined;
  /** The open comment threads' words, in offsets of `markdown`, which the editor carries as they move; none where the document has no comments. */
  readonly anchors?: readonly EditorAnchor[] | undefined;
  /** Starts a thread on the words selected, from the toolbar's Comment or its chord; none where the document takes no comments. */
  readonly onComment?: (() => void) | undefined;
  /** Whether a Mermaid block's diagram is previewed under it. */
  readonly diagrams?: boolean | undefined;
  /** The document's own blocks, offered in its `/` menu beside the menu's. */
  readonly ownBlocks?: readonly OwnBlock[] | undefined;
  /** The `/` menu's blocks that do not apply to the document, which it does not offer. */
  readonly droppedBlocks?: ReadonlySet<SlashBlock> | undefined;
}

/** The bundle's editor mounted in place, built once, on the text it opened with; its handle kept for its document. */
function MountedEditor({
  module,
  props,
  handle,
}: {
  module: PlanEditorModule;
  props: PlanEditorProps;
  handle: RefObject<PlanEditorHandle | undefined>;
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  useLayoutEffect(() => {
    if (host.current === null) return;
    const { mentions } = latest.current;
    const mounted = module.mount(host.current, {
      ...latest.current,
      onDraft: (markdown, anchors) => latest.current.onDraft(markdown, anchors),
      onFinish: (section, how) => latest.current.onFinish(section, how),
      onLeaveUp:
        latest.current.onLeaveUp === undefined ? undefined : () => latest.current.onLeaveUp?.(),
      // Note that the mentions' doors are read as they are used, as the rest are.
      mentions:
        mentions === undefined
          ? undefined
          : {
              onTrigger: (trigger) => latest.current.mentions?.onTrigger(trigger),
              onKey: (event) => latest.current.mentions?.onKey(event) ?? false,
              drawMention: (element, mention, node) =>
                latest.current.mentions?.drawMention(element, mention, node) ?? (() => undefined),
              retarget: (target, renamed) => latest.current.mentions?.retarget(target, renamed),
              pasted: (words) => latest.current.mentions?.pasted(words),
              namesMention: (target) => latest.current.mentions?.namesMention(target) ?? false,
            },
      drawDiagram:
        latest.current.drawDiagram === undefined
          ? undefined
          : (element, diagram) =>
              latest.current.drawDiagram?.(element, diagram) ?? (() => undefined),
      format:
        latest.current.format === undefined
          ? undefined
          : {
              onFormat: (format) => latest.current.format?.onFormat(format),
              onLink: () => latest.current.format?.onLink(),
            },
      blocks:
        latest.current.blocks === undefined
          ? undefined
          : {
              onTrigger: (trigger) => latest.current.blocks?.onTrigger(trigger),
              onKey: (event) => latest.current.blocks?.onKey(event) ?? false,
            },
    });
    handle.current = mounted;
    return () => {
      handle.current = undefined;
      mounted.destroy();
    };
  }, [module, handle]);
  return <div ref={host} />;
}

/** The editor of a Markdown document, mounted in its room as its bundle lands, with every option the document takes. */
export function MarkdownEditor({
  markdown,
  label,
  roomLabel,
  placeholder,
  className,
  roomClassName,
  focus = true,
  onDraft,
  onFinish,
  onLeave,
  handle: givenHandle,
  room: givenRoom,
  loading,
  children,
  placement,
  onLeaveUp,
  mentions,
  pictures,
  anchors,
  onComment,
  diagrams = false,
  ownBlocks,
  droppedBlocks,
}: MarkdownEditorProps): React.JSX.Element {
  const ownHandle = useRef<PlanEditorHandle | undefined>(undefined);
  const handle = givenHandle ?? ownHandle;
  const ownRoom = useRef<HTMLElement>(null);
  const room = givenRoom ?? ownRoom;
  const module = useAtomValue(useSideBundles().planEditor);
  const chips = useEditorDrawings<DrawnMention>();
  const previews = useEditorDrawings<EditorDiagram>();
  // Note that a finish or a leaving waits for a picture still being kept, since only the open editor can lay in its address; it goes once none is.
  const held = useRef<(() => void) | undefined>(undefined);
  const sending = pictures?.sending === true;
  const once = (close: () => void) => {
    if (sending) held.current = close;
    else close();
  };
  useEffect(() => {
    const close = held.current;
    if (sending || close === undefined) return;
    held.current = undefined;
    close();
  });
  // Note that the editor's own text is read, since the draft is handed over only once typing pauses.
  const text = () => handle.current?.markdown() ?? markdown;
  // A Luke address pasted whole is called by the name the window holds for what it names.
  const known = useKnownNames();
  const picker = useMentionPicker({
    source: mentions === undefined ? undefined : { ...mentions.source, text },
    room,
    side: MENTION_MENU_SIDE.BELOW,
    onChoose: (mention) => handle.current?.chooseMention(mention),
  });
  const mentioning = picker.aria["aria-expanded"] === "true";
  // A `/` opens the block menu under it, which stands aside while the `@` list stands; its Picture opens the chooser Insert image opens.
  const blocks = useBlockPicker({
    room,
    offers: { pictures: pictures?.choose !== undefined, mentions: mentions !== undefined },
    rows: { added: ownBlocks ?? [], dropped: droppedBlocks ?? new Set() },
    held: mentioning,
    onChoose: (block) => {
      handle.current?.insertBlock(block);
      if (block === SLASH_INSERT.PICTURE) pictures?.choose?.();
    },
  });
  // The text names itself a combobox for whichever list stands over it, the `@` list or the block menu, and a textbox while neither does.
  useLayoutEffect(() => handle.current?.setAria(mentioning ? picker.aria : blocks.aria));
  // The words selected raise the format toolbar over them, which stands aside while the `@` list or the block menu stands.
  const toolbar = useSelectionToolbar({
    editor: handle,
    room,
    blocks: true,
    onComment,
    held: mentioning || blocks.open,
  });
  // While the toolbar stands, its Comment's command starts the thread as a press on it does.
  useAppCommand(APP_COMMAND.COMMENT_ON_SELECTION, toolbar.standing ? onComment : undefined);
  const roomClass =
    roomClassName === undefined
      ? `${ROOM_CLASS} ph-no-capture`
      : `${ROOM_CLASS} ${roomClassName} ph-no-capture`;
  useAnnounceShown(ANNOUNCE.ALERT, AsyncResult.isFailure(module) ? EDITOR_LOAD_FAILED : "");
  if (!AsyncResult.isSuccess(module)) {
    return (
      <section ref={room} className={roomClass} aria-busy="true">
        {loading}
        {AsyncResult.isFailure(module) ? (
          <p className={EDITOR_NOTE_CLASS}>{EDITOR_LOAD_FAILED}</p>
        ) : null}
      </section>
    );
  }
  const props: PlanEditorProps = {
    markdown,
    anchors,
    placement,
    focus,
    label,
    placeholder,
    className,
    onDraft,
    onFinish: (section, how) => once(() => onFinish(section, how)),
    onLeaveUp,
    mentions:
      mentions === undefined
        ? undefined
        : {
            onTrigger: picker.onTrigger,
            onKey: picker.onKey,
            drawMention: (element, mention, node) => chips.draw(element, { mention, node }),
            retarget: (target, change) => mentions.retarget?.(target, change),
            pasted: (words) =>
              pastedMentionNode(words, mentions.doors.place, {
                known,
                taskId: mentions.source.taskId,
                text,
              }),
            namesMention: (target) =>
              decodeMention(target, mentions.doors.place.repository) !== undefined,
          },
    drawDiagram: diagrams ? previews.draw : undefined,
    pictures: pictures?.pictures,
    format: toolbar.doors,
    blocks: { onTrigger: blocks.onTrigger, onKey: blocks.onKey },
  };
  return (
    <section
      ref={room}
      className={roomClass}
      aria-label={roomLabel}
      onBlur={(event) => {
        const into = event.relatedTarget;
        if (onLeave === undefined || event.currentTarget.contains(into) || toolbar.holds(into)) {
          return;
        }
        once(onLeave);
      }}
    >
      <MountedEditor module={module.value} props={props} handle={handle} />
      {toolbar.drawn}
      {blocks.menu}
      {children}
      {pictures?.drawn}
      {mentions === undefined ? null : picker.menu}
      {mentions === undefined
        ? null
        : chips.drawn.map((each) =>
            createPortal(
              <MentionNodeChip
                mention={each.what.mention}
                doors={mentions.doors}
                edit={{ node: each.what.node, pickDate: picker.pickDate }}
              />,
              each.element,
              each.key,
            ),
          )}
      {previews.drawn.map((each) =>
        createPortal(
          <DiagramPreview code={each.what.code} previous={each.what.previous} />,
          each.element,
          each.key,
        ),
      )}
    </section>
  );
}

/** A mention the editor asked to be drawn: what it holds, and the doors to its node. */
interface DrawnMention {
  readonly mention: MentionNode;
  readonly node: MentionNodeDoors;
}

/** Something the editor asked to be drawn: the element it stands as, what it is, and the key its drawing goes under. */
interface DrawnInEditor<A> {
  readonly element: HTMLElement;
  readonly what: A;
  readonly key: number;
}

/** What the editor holds as drawn, and the door the editor asks to draw one through. */
interface EditorDrawings<A> {
  readonly drawn: readonly DrawnInEditor<A>[];
  readonly draw: (element: HTMLElement, what: A) => () => void;
}

/**
 * What the editor asks the panel to draw, a mention or a diagram, each drawn
 * into its own element while it stands, as the composer draws its chips.
 */
function useEditorDrawings<A>(): EditorDrawings<A> {
  const [drawn, setDrawn] = useState<readonly DrawnInEditor<A>[]>([]);
  const counted = useRef(0);
  const draw = (element: HTMLElement, what: A) => {
    counted.current += 1;
    const key = counted.current;
    setDrawn((was) => [...was, { element, what, key }]);
    return () => setDrawn((was) => was.filter((each) => each.key !== key));
  };
  return { drawn, draw };
}
