import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "@repo/ui";
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
import { type KeystrokeSpanName, PANEL_SPAN, useKeystrokeSpans } from "../panel-spans.js";
import type {
  ComposerChip,
  ComposerEditorHandle,
  ComposerInput,
  ComposerQuote,
  ComposerTrigger,
  MentionNode,
  MentionNodeDoors,
  DescriptionEditorModule,
} from "../description-editor/contract.js";
import { useSelectionToolbar } from "./selection-toolbar.js";

const FIELD_CLASS = "ph-no-capture agent-composer-input";

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

export function ComposerPlaceholder({ children }: { children: string }): React.JSX.Element {
  return (
    <Text
      as={TEXT_ELEMENT.SPAN}
      variant={TEXT_VARIANT.INHERIT}
      truncate
      className="agent-composer-placeholder"
      aria-hidden="true"
    >
      {children}
    </Text>
  );
}

export function UnloadedComposerField(): React.JSX.Element {
  return <div className={FIELD_CLASS} aria-busy="true" />;
}

function typingElsewhere(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body) return false;
  return (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active.isContentEditable
  );
}

interface DrawnChip {
  readonly element: HTMLElement;
  readonly chip:
    | ComposerChip
    | { readonly mention: MentionNode; readonly node: MentionNodeDoors }
    | { readonly quote: ComposerQuote };
  readonly key: number;
}

export interface ComposerFieldMentions {
  readonly onTrigger: (trigger: ComposerTrigger | undefined) => void;
  readonly chip: (mention: MentionNode, node: MentionNodeDoors) => ReactNode;
  readonly pasted: (words: string) => MentionNode | undefined;
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
  onPasteFiles,
  onPasteCut,
  onTrigger,
  chip,
  quote,
  mentions,
  takesFocus = true,
  focus,
  keystrokeSpan = PANEL_SPAN.KEYSTROKE_COMPOSER,
  children,
}: {
  module: DescriptionEditorModule | undefined;
  editor: RefObject<ComposerEditorHandle | undefined>;
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
  onPasteFiles: (files: readonly File[]) => boolean;
  onPasteCut?: (() => void) | undefined;
  onTrigger: (trigger: ComposerTrigger | undefined) => void;
  chip: (chip: ComposerChip) => ReactNode;
  quote?: ((quote: ComposerQuote) => ReactNode) | undefined;
  mentions?: ComposerFieldMentions | undefined;
  takesFocus?: boolean;
  focus?: boolean | undefined;
  keystrokeSpan?: KeystrokeSpanName;
  children?: ReactNode;
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const editedLinks = useEditedLinksHost();
  const keystrokes = useKeystrokeSpans(keystrokeSpan);
  const roomHost = useCallback(
    (element: HTMLDivElement | null) => {
      room.current = element;
      editedLinks(element);
      keystrokes(element);
    },
    [room, editedLinks, keystrokes],
  );
  const [chips, setChips] = useState<readonly DrawnChip[]>([]);
  const toolbar = useSelectionToolbar({
    editor,
    room,
    blocks: false,
    held: aria["aria-expanded"] === "true",
  });
  const emitted = useRef(draft);
  const drawn = useRef(0);
  const latest = useRef({
    draft,
    setDraft,
    skills,
    onKey,
    onEnter,
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
    onPasteFiles,
    onPasteCut,
    onTrigger,
    mentions,
    takesFocus,
    focus,
    format: toolbar.doors,
  };

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
      {draft === "" ? <ComposerPlaceholder>{placeholder}</ComposerPlaceholder> : null}
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
