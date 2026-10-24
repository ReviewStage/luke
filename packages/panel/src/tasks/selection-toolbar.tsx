import { WRITING_MARK, type WritingBlock, type WritingMark } from "@luke/settings/shortcuts";
import { FormatToolbar, LinkField, POPOVER_SIDE, RectFloat } from "@luke/ui";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { FINGER_SELECTION_GAP, useCoarsePointer } from "../coarse-pointer.js";
import type {
  EditorBox,
  EditorFormat,
  EditorFormatDoors,
  EditorFormatting,
} from "../plan-editor/contract.js";
import { useOpenLink } from "./use-open-link.js";

/**
 * selection-toolbar.tsx -- the format toolbar over an editor's selected words, and the link field under them: when each stands, where, and what its presses do.
 *
 * Any of the panel's editors takes it: its owner hands the editor the doors
 * this answers (`doors`), through which the editor tells it the selection
 * after every change and hands it ⌘K, and draws what this answers
 * (`drawn`) inside the positioned box the editor stands in (`room`), where
 * each surface floats by the words (`RectFloat`). The toolbar stands once
 * the pointer is let go over words selected, or at once as the keyboard
 * selects them, and stands over the words as they change and as they
 * scroll; it stands nowhere while nothing is selected, while the selection
 * touches code, while the focus is elsewhere than the editor's box, and
 * while its owner holds it off, as a list over the caret does. Under a
 * finger it stands under the words, clear of the handle that ends them,
 * since the system's own menu stands over them. A press on it keeps the
 * editor's focus, so the words stay selected; Turn into, offered where the
 * editor's blocks can be turned and the words stand in no table's cell, hands the focus back to the editor as it
 * turns them. Its Link, or ⌘K, opens the link field under the words in its
 * place, where Enter links them, an address with no scheme taken as a web
 * page's, an empty field unlinks them, and Escape gives up, each handing
 * the focus back to the editor; Open and Remove act on the link already
 * there. A press anywhere else, or the focus leaving the editor's box,
 * closes it.
 */

/** A scheme an address opens with, `https:` or `mailto:`; a host's port, `localhost:3000`, is none. */
const SCHEME = /^[a-z][a-z\d+.-]*:(?!\d)/iu;

/** What the menu Turn into drops is drawn as, which the focus may go into while the toolbar stands. */
const MENU_SELECTOR = '[role="menu"]';

/** What a link field typed comes to: none where it is empty, which unlinks the words, and a web page's address where it names no scheme. */
function linkAddress(typed: string): string | undefined {
  const address = typed.trim();
  if (address === "") return undefined;
  return SCHEME.test(address) ? address : `https://${address}`;
}

/** Whether two reports of the selection draw the toolbar alike, so a change that moves nothing draws nothing. */
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

/** The selection's box stretched down past the handle a finger drags, which what stands under it keeps clear of. */
function pastHandle(box: EditorBox | undefined): EditorBox | undefined {
  return box === undefined ? undefined : { ...box, bottom: box.bottom + FINGER_SELECTION_GAP };
}

/** What the toolbar answers its owner. */
export interface SelectionToolbar {
  /** What the editor is handed as it mounts, to tell the toolbar its selection and its ⌘K. */
  readonly doors: EditorFormatDoors;
  /** The toolbar or the link field, where either stands, drawn inside the editor's positioned box. */
  readonly drawn: ReactNode;
  /** Whether the toolbar stands over the words now. */
  readonly standing: boolean;
  /** Whether the focus going to `target` stays the editor's: into the menu Turn into dropped. */
  readonly holds: (target: EventTarget | null) => boolean;
}

/**
 * The toolbar over the selection of the editor `editor` holds, in `room`,
 * the positioned box the editor stands in; Turn into offered where `blocks`
 * says the editor's blocks can be turned, Comment where `onComment` starts
 * one, and both held off while `held`.
 */
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
  // Whether a pointer is down anywhere but on the toolbar, whose selection is not made until it is let go.
  const [pressing, setPressing] = useState(false);
  // Whether the focus stands in the editor's box, or the menu Turn into dropped.
  const [focused, setFocused] = useState(false);
  // The link field, where it stands, with the link the words held as it opened.
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
  // Note that the menu is the toolbar's only while the toolbar stands, since only its Turn into drops one with the editor's words selected.
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
    // Note that the focus is read from where it is going, since the focus leaving the editor for the toolbar's menu must not take the toolbar down on the way.
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
    // Note that a key pressed ends any press whose pointerup the window missed, so a selection the keyboard makes after it stands the toolbar.
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
  // Each of the link field's ends hands the focus back to the editor, its words still selected.
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
