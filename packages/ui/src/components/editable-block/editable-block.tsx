import {
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
} from "react";

/**
 * editable-block.tsx -- one block of a document edited in place: a title or a section, which the keyboard selects and steps between, and which a press or Return opens to be edited.
 *
 * Nothing on a block marks it editable: its words take the text cursor, and
 * a block the keyboard selects wears a soft tint a little past its words,
 * as a document editor marks a selected block. The document is one Tab
 * stop, at the block its owner names the entry; ↑ and ↓ step to the block
 * before or after, across every block on the page; Return opens the block,
 * and a press on its own words does. A block is a labelled group rather
 * than a button, so a screen reader still reads the words inside it. A
 * scrolling code block inside it is taken out of the Tab order, because
 * Chrome makes a scrolling `<pre>` a Tab stop of its own inside the
 * document's one.
 */

/** What every block wears, which the page's blocks are stepped across by. */
export const EDITABLE_BLOCK_CLASS = "luke-editable-block";

/** What a block holds: the document's title, or a section of its text. */
export const EDITABLE_BLOCK_KIND = {
  TITLE: "title",
  TEXT: "text",
} as const;

export type EditableBlockKind = (typeof EDITABLE_BLOCK_KIND)[keyof typeof EDITABLE_BLOCK_KIND];

/** What finds the text's blocks, the title's apart, under an element: its `data-block-kind`. */
export const EDITABLE_TEXT_BLOCK_SELECTOR = `[data-block-kind="${EDITABLE_BLOCK_KIND.TEXT}"]`;

/** A press on a block's own words: where it landed, and the block it landed in. */
export interface EditableBlockPress {
  readonly target: Node;
  readonly x: number;
  readonly y: number;
  readonly block: HTMLElement;
}

/** The keyboard moved to the block before or after `from` on the page. */
function stepBlock(from: HTMLElement, by: 1 | -1): void {
  const blocks = [...document.querySelectorAll<HTMLElement>(`.${EDITABLE_BLOCK_CLASS}`)];
  blocks[blocks.indexOf(from) + by]?.focus();
}

/**
 * A block of a document. `onOpen` hears Return on the block itself, and
 * `onPress` a click on its words. Note that a click on a menu or a card
 * portaled out of the block still bubbles here through React's tree, and
 * is no press on the block's words, so `onPress` never hears it.
 */
export function EditableBlock({
  label,
  kind,
  entry,
  ref,
  onOpen,
  onPress,
  onFocus,
  onPointerEnter,
  children,
}: {
  label: string;
  kind: EditableBlockKind;
  /** Whether this block is where Tab enters the document. */
  entry: boolean;
  /** What the owner focuses the block through, as when an editor closes back onto it. */
  ref?: RefObject<HTMLDivElement | null> | undefined;
  onOpen: () => void;
  onPress?: ((press: EditableBlockPress) => void) | undefined;
  onFocus?: ((event: FocusEvent<HTMLDivElement>) => void) | undefined;
  onPointerEnter?: ((event: PointerEvent<HTMLDivElement>) => void) | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const own = useRef<HTMLDivElement | null>(null);
  const block = ref ?? own;
  useEffect(() => {
    for (const code of block.current?.querySelectorAll("pre") ?? []) code.tabIndex = -1;
  });
  const pressed = (event: MouseEvent<HTMLDivElement>) => {
    const { target, currentTarget } = event;
    if (onPress === undefined || !(target instanceof Node) || !currentTarget.contains(target)) {
      return;
    }
    onPress({ target, x: event.clientX, y: event.clientY, block: currentTarget });
  };
  const keyed = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      stepBlock(event.currentTarget, event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    onOpen();
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a block holds a section's words, not a form's controls, so it is no `<fieldset>`.
    <div
      ref={block}
      className={EDITABLE_BLOCK_CLASS}
      data-block-kind={kind}
      role="group"
      tabIndex={entry ? 0 : -1}
      aria-label={label}
      aria-keyshortcuts="Enter"
      onPointerEnter={onPointerEnter}
      onFocus={onFocus}
      onClick={pressed}
      onKeyDown={keyed}
    >
      {children}
    </div>
  );
}
