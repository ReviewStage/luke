import { TEXT_AREA_SUBMIT, TEXT_ELEMENT, TEXT_VARIANT, Text, type TextAreaSubmit } from "@luke/ui";
import {
  type ReactNode,
  type Ref,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useEditedLinksHost } from "../link-menu.js";
import type {
  ComposerChip,
  ComposerEditorHandle,
  ComposerInput,
  ComposerQuote,
  ComposerTrigger,
  MentionNode,
  MentionNodeDoors,
  PlanEditorModule,
} from "../plan-editor/contract.js";
import { useSelectionToolbar } from "./selection-toolbar.js";

/**
 * composer-field.tsx -- the field of a box written to an agent, its message box's or the Inbox's answer box's: the editor bundle's composer mounted in the card, the words it hands back, and the commands that change them from outside.
 *
 * The field is TipTap (`../plan-editor/composer-editor.ts`), from the editor
 * bundle the panel starts loading as it first paints (`../bundle-loader.ts`).
 * In the rare frame before it lands, the field is drawn at its own size with
 * its placeholder, inert and out of the Tab order, and the editor takes the
 * caret as it mounts, unless the developer is typing somewhere else or the
 * box asks it not to, as the Inbox's does, where K and J step the list.
 *
 * The editor owns the words. Each change hands them back as the draft
 * string, and the draft is never written back into the editor as a render
 * goes by: a draft that moves from outside, emptied by a send that was
 * taken or refilled by a message that did not go, is told to the editor as
 * `clear` or `replace`, once, against the last words the editor itself
 * handed back, so its own echo is never laid in again. The placeholder is
 * words the field draws while the draft is empty, rather than an attribute
 * of the editor's, so the recording masks it as it masks the words. A chip
 * the editor holds is drawn by the box, into the node's own element, as the
 * owner draws it (`chip`), and so is a quote block (`quote`). Words
 * selected raise the format toolbar over them, its marks alone
 * (`./selection-toolbar.tsx`), which stands aside while a list the box
 * opened stands, as its `aria-expanded` says. The field's
 * look is its own (`.agent-composer-input`, tasks.css), in the body type,
 * and unrecorded (`ph-no-capture`), the same in both boxes.
 */

/** The editor's class, and the inert field's before it mounts. */
const FIELD_CLASS = "ph-no-capture agent-composer-input";

/**
 * The field's room in its card, which sizes the field from one line to its
 * cap (`.agent-composer-field`, tasks.css): the editor stands in it, and so
 * does the placeholder of a box still being read.
 */
export function ComposerFieldRoom({
  ref,
  children,
}: {
  ref?: Ref<HTMLDivElement> | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div ref={ref} className="agent-composer-field">
      {children}
    </div>
  );
}

/** The field before its editor mounts: drawn at the editor's own size and insets, inert. */
export function UnloadedComposerField(): React.JSX.Element {
  return <div className={FIELD_CLASS} aria-busy="true" />;
}

/** Whether the developer is typing somewhere the box must not take focus from: a field or an editor elsewhere. */
function typingElsewhere(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body) return false;
  return (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active.isContentEditable
  );
}

/** A chip the editor asked to be drawn: the element its node stands as, what it is, a skill, a mention, or a quote, and the key its drawing goes under. */
interface DrawnChip {
  readonly element: HTMLElement;
  readonly chip:
    | ComposerChip
    | { readonly mention: MentionNode; readonly node: MentionNodeDoors }
    | { readonly quote: ComposerQuote };
  readonly key: number;
}

/** What the box's mentions are picked and drawn with: the `@` word's report, and each mention's look. */
export interface ComposerFieldMentions {
  readonly onTrigger: (trigger: ComposerTrigger | undefined) => void;
  /** A mention's chip, handed the doors to its node. */
  readonly chip: (mention: MentionNode, node: MentionNodeDoors) => ReactNode;
  /** The mention words pasted whole stand for; nothing for words that paste as words. */
  readonly pasted: (words: string) => MentionNode | undefined;
  /** The `#` word's report, where the box names channels; none where it names none, read as it mounts. */
  readonly onChannelTrigger?: ((trigger: ComposerTrigger | undefined) => void) | undefined;
}

export function ComposerField({
  module,
  editor,
  room,
  draft,
  setDraft,
  placeholder,
  label,
  input,
  maxLength,
  skills,
  aria,
  onKey,
  onEnter,
  submitKey,
  onPasteFiles,
  onPasteCut,
  onTrigger,
  chip,
  quote,
  mentions,
  takesFocus = true,
  focus,
  children,
}: {
  /** The editor bundle; nothing until it has loaded, while the field stands inert. */
  module: PlanEditorModule | undefined;
  /** Where the mounted editor's handle is kept, for the box's commands. */
  editor: RefObject<ComposerEditorHandle | undefined>;
  /** The field's own element, which the lists over it stand in. */
  room: RefObject<HTMLDivElement | null>;
  draft: string;
  setDraft: (text: string) => void;
  placeholder: string;
  label: string;
  input: ComposerInput;
  maxLength: number;
  skills: ReadonlySet<string>;
  aria: Readonly<Record<string, string | undefined>>;
  onKey: (event: KeyboardEvent) => boolean;
  onEnter: () => void;
  /** The key that sends: Enter, or ⌘ or Ctrl with Enter where Enter must break the line; Enter where none is given. */
  submitKey?: TextAreaSubmit | undefined;
  onPasteFiles: (files: readonly File[]) => boolean;
  /** Told once a paste past `maxLength` has been cut to fit; a box that gives no word of it cuts silently. */
  onPasteCut?: (() => void) | undefined;
  onTrigger: (trigger: ComposerTrigger | undefined) => void;
  chip: (chip: ComposerChip) => ReactNode;
  /** How a quote block the editor holds is drawn; its words alone where none is given. */
  quote?: ((quote: ComposerQuote) => ReactNode) | undefined;
  /** What the box's mentions are picked and drawn with; none where the box takes no mentions, read as it mounts. */
  mentions?: ComposerFieldMentions | undefined;
  /** Whether the editor takes the caret as it mounts, unless the developer is typing elsewhere; a box that stands beside a list the keys step through takes none. */
  takesFocus?: boolean;
  /** Whether the editor takes the caret as it mounts, over `takesFocus` and whoever is typing elsewhere; left out, those decide. Read as it mounts. */
  focus?: boolean | undefined;
  /** What stands over the field, a list it opened. */
  children?: ReactNode;
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  // A link in the draft opens, from its right-click, where the box stands.
  const editedLinks = useEditedLinksHost();
  const roomHost = useCallback(
    (element: HTMLDivElement | null) => {
      room.current = element;
      editedLinks(element);
    },
    [room, editedLinks],
  );
  const [chips, setChips] = useState<readonly DrawnChip[]>([]);
  const toolbar = useSelectionToolbar({
    editor,
    room,
    blocks: false,
    held: aria["aria-expanded"] === "true",
  });
  // The last words the editor handed back, which a draft from outside is told against.
  const emitted = useRef(draft);
  const drawn = useRef(0);
  const latest = useRef({
    draft,
    setDraft,
    skills,
    onKey,
    onEnter,
    submitKey,
    onPasteFiles,
    onPasteCut,
    onTrigger,
    mentions,
    takesFocus,
    focus,
    format: toolbar.doors,
  });
  latest.current = {
    draft,
    setDraft,
    skills,
    onKey,
    onEnter,
    submitKey,
    onPasteFiles,
    onPasteCut,
    onTrigger,
    mentions,
    takesFocus,
    focus,
    format: toolbar.doors,
  };

  /** A chip the editor asked for, drawn into its node's element until the node goes. */
  const draw = (element: HTMLElement, drawnChip: DrawnChip["chip"]) => {
    drawn.current += 1;
    const key = drawn.current;
    setChips((was) => [...was, { element, chip: drawnChip, key }]);
    return () => setChips((was) => was.filter((each) => each.key !== key));
  };
  useLayoutEffect(() => {
    if (module === undefined || host.current === null) return;
    const now = latest.current;
    emitted.current = now.draft;
    const mounted = module.mountComposer(host.current, {
      text: now.draft,
      skills: now.skills,
      maxLength,
      label,
      className: FIELD_CLASS,
      focus: now.focus ?? (now.takesFocus && !typingElsewhere()),
      onDraft: (text) => {
        emitted.current = text;
        latest.current.setDraft(text);
      },
      onKey: (event) => latest.current.onKey(event),
      onEnter: () => latest.current.onEnter(),
      submitKey: () => latest.current.submitKey ?? TEXT_AREA_SUBMIT.ENTER,
      onPasteFiles: (files) => latest.current.onPasteFiles(files),
      onPasteCut: () => latest.current.onPasteCut?.(),
      onTrigger: (trigger) => latest.current.onTrigger(trigger),
      drawChip: (element, drawnChip) => draw(element, drawnChip),
      drawQuote: (element, drawnQuote) => draw(element, { quote: drawnQuote }),
      mentions:
        now.mentions === undefined
          ? undefined
          : {
              onTrigger: (trigger) => latest.current.mentions?.onTrigger(trigger),
              drawMention: (element, mention, node) => draw(element, { mention, node }),
              pasted: (words) => latest.current.mentions?.pasted(words),
              onChannelTrigger:
                now.mentions.onChannelTrigger === undefined
                  ? undefined
                  : (trigger) => latest.current.mentions?.onChannelTrigger?.(trigger),
            },
      format: {
        onFormat: (format) => latest.current.format.onFormat(format),
        onLink: () => latest.current.format.onLink(),
      },
    });
    editor.current = mounted;
    return () => {
      editor.current = undefined;
      mounted.destroy();
    };
  }, [module, editor, maxLength, label]);

  // A draft that moved from outside is told to the editor once; its own words handed back are not.
  useLayoutEffect(() => {
    const mounted = editor.current;
    if (mounted === undefined || draft === emitted.current) return;
    emitted.current = draft;
    if (draft === "") mounted.clear();
    else mounted.replace(draft);
  }, [draft, editor]);
  useLayoutEffect(() => editor.current?.setInput(input), [input, editor, module]);
  useLayoutEffect(() => editor.current?.setSkills(skills), [skills, editor, module]);
  useLayoutEffect(() => editor.current?.setAria(aria));

  return (
    <ComposerFieldRoom ref={roomHost}>
      {draft === "" ? (
        <Text
          as={TEXT_ELEMENT.SPAN}
          variant={TEXT_VARIANT.INHERIT}
          truncate
          className="agent-composer-placeholder"
          aria-hidden="true"
        >
          {placeholder}
        </Text>
      ) : null}
      {module === undefined ? <UnloadedComposerField /> : <div ref={host} />}
      {chips.map((each) =>
        createPortal(
          "mention" in each.chip
            ? (mentions?.chip(each.chip.mention, each.chip.node) ?? `@${each.chip.mention.name}`)
            : "quote" in each.chip
              ? (quote?.(each.chip.quote) ?? each.chip.quote.words)
              : chip(each.chip),
          each.element,
          each.key,
        ),
      )}
      {toolbar.drawn}
      {children}
    </ComposerFieldRoom>
  );
}
