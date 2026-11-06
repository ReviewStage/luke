import { useAtomValue } from "@effect/atom-react";
import { decodeMention } from "@repo/features/mention-link";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { ANNOUNCE, Checkbox } from "@repo/ui";
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
import { DiagramPreview } from "../description-diagram.js";
import {
  type EditorAnchor,
  type EditorAnchors,
  type EditorDiagram,
  type EditorTaskBox,
  type Finish,
  type HeadingsChange,
  type MentionNode,
  type MentionNodeDoors,
  type DescriptionEditorHandle,
  type DescriptionEditorModule,
  type DescriptionEditorPlacement,
  type DescriptionEditorProps,
  SLASH_INSERT,
  type SlashBlock,
} from "../description-editor/contract.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { type OwnBlock, useBlockPicker } from "./block-picker.js";
import type { EditorPictures } from "./editor-pictures.js";
import { type MentionDoors, MentionNodeChip, pastedMentionNode } from "./mention-chip.js";
import { holderTaskId } from "./mention-holder.js";
import { MENTION_MENU_SIDE, type MentionSource, useMentionPicker } from "./mention-picker.js";
import { useSelectionToolbar } from "./selection-toolbar.js";
import { useKnownNames } from "./use-known-names.js";
import { useNumberedTaskIdOf } from "./use-link-standing.js";

const ROOM_CLASS = "markdown-editor relative";

const EDITOR_LOAD_FAILED = "The editor could not be loaded.";

export const EDITOR_NOTE_CLASS =
  "description-editor-note flex flex-wrap items-center gap-control-gap text-caption text-muted-foreground";

interface MarkdownEditorMentions {
  readonly doors: MentionDoors;
  readonly source: Omit<MentionSource, "text">;
  readonly retarget?:
    | ((target: string, change: HeadingsChange) => MentionNode | undefined)
    | undefined;
}

export interface MarkdownEditorProps {
  readonly markdown: string;
  readonly label: string;
  readonly roomLabel: string;
  readonly placeholder: string;
  readonly className: string;
  readonly roomClassName?: string | undefined;
  readonly focus?: boolean | undefined;
  readonly onDraft: (markdown: string, anchors?: EditorAnchors) => void;
  readonly onFinish: (section: number, how: Finish) => void;
  readonly sendsOnEnter?: boolean | undefined;
  readonly onLeave?: (() => void) | undefined;
  readonly handle?: RefObject<DescriptionEditorHandle | undefined> | undefined;
  readonly room?: RefObject<HTMLElement | null> | undefined;
  readonly loading?: ReactNode;
  readonly children?: ReactNode;
  readonly placement?: DescriptionEditorPlacement | undefined;
  readonly onLeaveUp?: (() => void) | undefined;
  readonly mentions?: MarkdownEditorMentions | undefined;
  readonly pictures?: EditorPictures | undefined;
  readonly anchors?: readonly EditorAnchor[] | undefined;
  readonly onComment?: (() => void) | undefined;
  readonly diagrams?: boolean | undefined;
  readonly ownBlocks?: readonly OwnBlock[] | undefined;
  readonly droppedBlocks?: ReadonlySet<SlashBlock> | undefined;
}

function MountedEditor({
  module,
  props,
  handle,
}: {
  module: DescriptionEditorModule;
  props: DescriptionEditorProps;
  handle: RefObject<DescriptionEditorHandle | undefined>;
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
      drawTaskBox:
        latest.current.drawTaskBox === undefined
          ? undefined
          : (element, box) => latest.current.drawTaskBox?.(element, box) ?? (() => undefined),
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
  sendsOnEnter,
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
  const ownHandle = useRef<DescriptionEditorHandle | undefined>(undefined);
  const handle = givenHandle ?? ownHandle;
  const ownRoom = useRef<HTMLElement>(null);
  const room = givenRoom ?? ownRoom;
  const module = useAtomValue(useSideBundles().descriptionEditor);
  const chips = useEditorDrawings<DrawnMention>();
  const previews = useEditorDrawings<EditorDiagram>();
  const taskBoxes = useEditorDrawings<EditorTaskBox>();
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
  const text = () => handle.current?.markdown() ?? markdown;
  const known = useKnownNames();
  const taskIdOf = useNumberedTaskIdOf();
  const picker = useMentionPicker({
    source: mentions === undefined ? undefined : { ...mentions.source, text },
    room,
    side: MENTION_MENU_SIDE.BELOW,
    onChoose: (mention) => handle.current?.chooseMention(mention),
  });
  const mentioning = picker.aria["aria-expanded"] === "true";
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
  useLayoutEffect(() => handle.current?.setAria(mentioning ? picker.aria : blocks.aria));
  const toolbar = useSelectionToolbar({
    editor: handle,
    room,
    blocks: true,
    onComment,
    held: mentioning || blocks.open,
  });
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
  const props: DescriptionEditorProps = {
    markdown,
    anchors,
    placement,
    focus,
    label,
    placeholder,
    className,
    onDraft,
    onFinish: (section, how) => once(() => onFinish(section, how)),
    sendsOnEnter,
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
                taskIdOf,
                taskId: holderTaskId(mentions.source.holder),
                text,
              }),
            namesMention: (target) =>
              decodeMention(target, mentions.doors.place.repository) !== undefined,
          },
    drawDiagram: diagrams ? previews.draw : undefined,
    drawTaskBox: taskBoxes.draw,
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
      {taskBoxes.drawn.map((each) =>
        createPortal(
          <Checkbox
            label={each.what.label}
            checked={each.what.checked}
            onChange={each.what.toggle}
          />,
          each.element,
          each.key,
        ),
      )}
    </section>
  );
}

interface DrawnMention {
  readonly mention: MentionNode;
  readonly node: MentionNodeDoors;
}

interface DrawnInEditor<A> {
  readonly element: HTMLElement;
  readonly what: A;
  readonly key: number;
}

interface EditorDrawings<A> {
  readonly drawn: readonly DrawnInEditor<A>[];
  readonly draw: (element: HTMLElement, what: A) => () => void;
}

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
