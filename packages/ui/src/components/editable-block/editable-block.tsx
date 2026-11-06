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

export const EDITABLE_BLOCK_CLASS = "ui-editable-block";

export const EDITABLE_BLOCK_KIND = {
  TITLE: "title",
  TEXT: "text",
} as const;

export type EditableBlockKind = (typeof EDITABLE_BLOCK_KIND)[keyof typeof EDITABLE_BLOCK_KIND];

export const EDITABLE_TEXT_BLOCK_SELECTOR = `[data-block-kind="${EDITABLE_BLOCK_KIND.TEXT}"]`;

export interface EditableBlockPress {
  readonly target: Node;
  readonly x: number;
  readonly y: number;
  readonly block: HTMLElement;
}

function stepBlock(from: HTMLElement, by: 1 | -1): void {
  const blocks = [...document.querySelectorAll<HTMLElement>(`.${EDITABLE_BLOCK_CLASS}`)];
  blocks[blocks.indexOf(from) + by]?.focus();
}

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
  entry: boolean;
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
