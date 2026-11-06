import { WRITING_MARK, type WritingBlock, type WritingMark } from "@repo/settings/shortcuts";
import { FormatToolbar, LinkField, POPOVER_SIDE, RectFloat } from "@repo/ui";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { FINGER_SELECTION_GAP, useCoarsePointer } from "../coarse-pointer.js";
import type {
  EditorBox,
  EditorFormat,
  EditorFormatDoors,
  EditorFormatting,
} from "../description-editor/contract.js";
import { useOpenLink } from "./use-open-link.js";

const SCHEME = /^[a-z][a-z\d+.-]*:(?!\d)/iu;

const MENU_SELECTOR = '[role="menu"]';

function linkAddress(typed: string): string | undefined {
  const address = typed.trim();
  if (address === "") return undefined;
  return SCHEME.test(address) ? address : `https://${address}`;
}

function sameFormat(a: EditorFormat | undefined, b: EditorFormat): boolean {
  return (
    a !== undefined &&
    a.from === b.from &&
    a.to === b.to &&
    a.empty === b.empty &&
    a.code === b.code &&
    a.cell === b.cell &&
    a.block === b.block &&
    a.link === b.link &&
    a.marks.length === b.marks.length &&
    a.marks.every((mark, at) => mark === b.marks[at])
  );
}

function pastHandle(box: EditorBox | undefined): EditorBox | undefined {
  return box === undefined ? undefined : { ...box, bottom: box.bottom + FINGER_SELECTION_GAP };
}

export interface SelectionToolbar {
  readonly doors: EditorFormatDoors;
  readonly drawn: ReactNode;
  readonly standing: boolean;
  readonly holds: (target: EventTarget | null) => boolean;
}

export function useSelectionToolbar({
  editor,
  room,
  blocks,
  onComment,
  held,
}: {
  editor: RefObject<EditorFormatting | undefined>;
  room: RefObject<HTMLElement | null>;
  blocks: boolean;
  onComment?: (() => void) | undefined;
  held: boolean;
}): SelectionToolbar {
  const [format, setFormat] = useState<EditorFormat | undefined>(undefined);
  const [pressing, setPressing] = useState(false);
  const [focused, setFocused] = useState(false);
  const [linking, setLinking] = useState<{ readonly href: string | undefined } | undefined>(
    undefined,
  );
  const coarse = useCoarsePointer();
  const openLink = useOpenLink();
  const toolbar = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const standing =
    format !== undefined &&
    !format.empty &&
    !format.code &&
    focused &&
    !pressing &&
    !held &&
    linking === undefined;
  const latest = useRef({ format, standing, linking });
  latest.current = { format, standing, linking };
  const holds = (target: EventTarget | null) =>
    target instanceof Element && latest.current.standing && target.closest(MENU_SELECTOR) !== null;
  const holdsNow = useRef(holds);
  holdsNow.current = holds;

  useEffect(() => {
    const inRoom = (target: EventTarget | null) =>
      target instanceof Node &&
      (room.current?.contains(target) === true || holdsNow.current(target));
    const onFloat = (target: EventTarget | null) =>
      target instanceof Node &&
      (toolbar.current?.contains(target) === true || field.current?.contains(target) === true);
    const moved = (event: FocusEvent) => {
      const to = event.type === "focusout" ? event.relatedTarget : event.target;
      const here = inRoom(to);
      setFocused(here);
      if (!here) setLinking(undefined);
    };
    const down = (event: PointerEvent) => {
      if (onFloat(event.target) || holdsNow.current(event.target)) return;
      setPressing(true);
      setLinking(undefined);
    };
    const up = () => setPressing(false);
    setFocused(inRoom(document.activeElement));
    document.addEventListener("focusin", moved);
    document.addEventListener("focusout", moved);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
    document.addEventListener("keydown", up, true);
    return () => {
      document.removeEventListener("focusin", moved);
      document.removeEventListener("focusout", moved);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
      document.removeEventListener("keydown", up, true);
    };
  }, [room]);

  const link = () => setLinking({ href: latest.current.format?.link });
  const linked = (href: string | undefined) => {
    editor.current?.setLink(href);
    setLinking(undefined);
    editor.current?.focus();
  };
  const mark = (pressed: WritingMark) => {
    if (pressed === WRITING_MARK.LINK) link();
    else editor.current?.toggleMark(pressed);
  };
  const turn = (block: WritingBlock) => {
    editor.current?.turnInto(block);
    editor.current?.focus();
  };
  const words = () => editor.current?.selectionBox();
  const drawnToolbar =
    !standing || format === undefined ? null : (
      <RectFloat
        open
        anchor={coarse ? () => pastHandle(words()) : words}
        side={coarse ? POPOVER_SIDE.BELOW : POPOVER_SIDE.ABOVE}
      >
        <FormatToolbar
          ref={toolbar}
          marks={format.marks}
          onMark={mark}
          turnInto={blocks && !format.cell ? { current: format.block, onTurn: turn } : undefined}
          onComment={onComment}
        />
      </RectFloat>
    );
  const href = linking?.href;
  const drawnField =
    linking === undefined ? null : (
      <RectFloat open anchor={words} side={POPOVER_SIDE.BELOW}>
        <LinkField
          ref={field}
          href={href}
          onApply={(typed) => linked(linkAddress(typed))}
          onCancel={() => {
            setLinking(undefined);
            editor.current?.focus();
          }}
          onOpen={href === undefined ? undefined : () => openLink(href)}
          onRemove={() => linked(undefined)}
        />
      </RectFloat>
    );
  return {
    doors: {
      onFormat: (next) => setFormat((last) => (sameFormat(last, next) ? last : next)),
      onLink: link,
    },
    drawn: (
      <>
        {drawnToolbar}
        {drawnField}
      </>
    ),
    standing,
    holds,
  };
}
