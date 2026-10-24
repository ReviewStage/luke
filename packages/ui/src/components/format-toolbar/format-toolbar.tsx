import {
  APP_COMMAND,
  SHORTCUT_KEY,
  type ShortcutChord,
  WRITING_MARK,
  WRITING_SHORTCUTS,
  type WritingBlock,
  type WritingMark,
  type WritingShortcut,
} from "@luke/settings/shortcuts";
import { Fragment, type KeyboardEvent, type ReactNode, type Ref, useRef, useState } from "react";
import { ChevronDownIcon } from "../../face/glyphs.js";
import { CommentAddIcon } from "../../icons/lucide-glyphs.js";
import { Button, IconButton } from "../button/button.js";
import { dropBelowStart, useMenu } from "../menu/menu.js";
import { MENU_SURFACE_FLOW, MenuSurface } from "../menu/menu-surface.js";
import { Tooltip } from "../tooltip/hint.js";
import { TurnIntoMenu } from "../turn-into-menu/turn-into-menu.js";
import { WritingGlyph } from "../writing-glyph/writing-glyph.js";

/**
 * format-toolbar.tsx -- the toolbar over selected words: Turn into ▾, then Bold, Italic, Strikethrough, and Code, then Link, then Comment, each group a hairline apart.
 *
 * It stands on the menu's surface in toolbar flow, as the read view's
 * Comment bubble does; it takes no class or style, so its owner places it
 * over the selection in a box of its own, and shows it. Each mark is a glyph that stands pressed while the selection
 * wears it; Turn into names the block the selection is in and drops the
 * blocks it can become (`TurnIntoMenu`); Comment, with its words, starts a
 * comment on the words. Turn into and Comment are drawn only where the
 * owner offers them, as a composer, which writes marks alone, does not.
 * Every press's hint names it and its chord, the vocabulary's
 * (`WRITING_SHORTCUTS`), so the toolbar teaches the keys that do without it.
 *
 * A press never takes the focus, so the selection it acts on stays
 * selected in the editor under it; what a press does is its owner's, told
 * by `onMark`, `onTurn`, and `onComment`. To the keyboard it is one
 * toolbar: Tab stops on it once, and ←, →, Home, and End move along it.
 */

/** The toolbar's own words. */
const FORMAT_TOOLBAR_WORDS = {
  GROUP: "Formatting",
  TURN_INTO: "Turn into",
  COMMENT: "Comment",
} as const;

/** The marks in the order they are drawn, in groups a hairline stands between. */
const MARK_GROUPS: readonly (readonly WritingMark[])[] = [
  [WRITING_MARK.BOLD, WRITING_MARK.ITALIC, WRITING_MARK.STRIKE, WRITING_MARK.CODE],
  [WRITING_MARK.LINK],
];

/**
 * Link's chord, which the vocabulary leaves out. Note that ⌘K is the
 * command palette's wherever no words are selected, so the editor answers
 * it only over a selection, and binds it apart from the vocabulary's
 * chords; the hint still names it, since the toolbar stands only over a
 * selection.
 */
const LINK_CHORD: ShortcutChord = { key: SHORTCUT_KEY.K };

/** Where each roving key moves the toolbar's one stop, from the stop it stands on among `count`. */
const ROVING_KEYS = new Map([
  ["ArrowRight", (at: number, count: number) => (at + 1) % count],
  ["ArrowLeft", (at: number, count: number) => (at - 1 + count) % count],
  ["Home", () => 0],
  ["End", (_at: number, count: number) => count - 1],
]);

/** What a press is handed to stand in the toolbar's one stop: its element, whether Tab stops on it, and its focus arriving. */
interface Roving {
  readonly ref: (button: HTMLButtonElement | null) => void;
  readonly tabbable: boolean;
  readonly onFocus: () => void;
}

/** One press as the toolbar lays it out: its key, and how it is drawn in the stop it stands in. */
interface Press {
  readonly key: string;
  readonly draw: (roving: Roving) => ReactNode;
}

/** The Turn into the toolbar offers: the block the selection is in, where it is one kind, and what turns it. */
export interface FormatToolbarTurnInto {
  readonly current: WritingBlock | undefined;
  readonly onTurn: (block: WritingBlock) => void;
}

/** The chord a mark's hint names. */
function markChord(mark: WritingMark): ShortcutChord | undefined {
  const shortcut: WritingShortcut = WRITING_SHORTCUTS[mark];
  return mark === WRITING_MARK.LINK ? LINK_CHORD : shortcut.chord;
}

/** Turn into's press, naming the current block, and the menu it drops. */
function TurnIntoPress({
  turnInto,
  roving,
}: {
  turnInto: FormatToolbarTurnInto;
  roving: Roving;
}): React.JSX.Element {
  const menu = useMenu(true);
  const block =
    turnInto.current === undefined ? undefined : WRITING_SHORTCUTS[turnInto.current].label;
  return (
    <>
      <Tooltip label={FORMAT_TOOLBAR_WORDS.TURN_INTO}>
        <Button
          {...roving}
          keepFocus
          label={block === undefined ? undefined : `${FORMAT_TOOLBAR_WORDS.TURN_INTO} ${block}`}
          trailing={<ChevronDownIcon />}
          {...menu.trigger(dropBelowStart)}
        >
          {block ?? FORMAT_TOOLBAR_WORDS.TURN_INTO}
        </Button>
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <TurnIntoMenu
          menu={menu.drawn}
          current={turnInto.current}
          onTurn={turnInto.onTurn}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** The presses in their groups, Turn into's and Comment's where they are offered. */
function pressGroups(props: {
  marks: readonly WritingMark[];
  onMark: (mark: WritingMark) => void;
  turnInto?: FormatToolbarTurnInto | undefined;
  onComment?: (() => void) | undefined;
}): Press[][] {
  const { turnInto, onComment } = props;
  const turn: Press[] =
    turnInto === undefined
      ? []
      : [
          {
            key: FORMAT_TOOLBAR_WORDS.TURN_INTO,
            draw: (roving) => <TurnIntoPress turnInto={turnInto} roving={roving} />,
          },
        ];
  const comment: Press[] =
    onComment === undefined
      ? []
      : [
          {
            key: FORMAT_TOOLBAR_WORDS.COMMENT,
            draw: (roving) => (
              <Tooltip
                label={FORMAT_TOOLBAR_WORDS.COMMENT}
                command={APP_COMMAND.COMMENT_ON_SELECTION}
              >
                <Button {...roving} keepFocus icon={<CommentAddIcon />} onClick={onComment}>
                  {FORMAT_TOOLBAR_WORDS.COMMENT}
                </Button>
              </Tooltip>
            ),
          },
        ];
  const marks = MARK_GROUPS.map((group) =>
    group.map(
      (mark): Press => ({
        key: mark,
        draw: (roving) => (
          <Tooltip label={WRITING_SHORTCUTS[mark].label} chord={markChord(mark)}>
            <IconButton
              {...roving}
              keepFocus
              icon={<WritingGlyph action={mark} />}
              label={WRITING_SHORTCUTS[mark].label}
              pressed={props.marks.includes(mark)}
              onClick={() => props.onMark(mark)}
            />
          </Tooltip>
        ),
      }),
    ),
  );
  return [turn, ...marks, comment].filter((group) => group.length > 0);
}

/**
 * The toolbar over a selection that wears `marks`, shown while the
 * selection stands, in a box of its owner's that places it.
 */
export function FormatToolbar({
  marks,
  onMark,
  turnInto,
  onComment,
  ref,
}: {
  /** The marks the whole selection wears, whose presses stand pressed. */
  marks: readonly WritingMark[];
  /** A mark's press: laying it on the selection, or taking it off. */
  onMark: (mark: WritingMark) => void;
  /** Turn into, where the owner's blocks can be turned; none in a box that writes marks alone. */
  turnInto?: FormatToolbarTurnInto | undefined;
  /** Comment's press, where the words can be commented on. */
  onComment?: (() => void) | undefined;
  ref?: Ref<HTMLDivElement> | undefined;
}): React.JSX.Element {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [stop, setStop] = useState(0);
  const groups = pressGroups({ marks, onMark, turnInto, onComment });
  const count = groups.flat().length;
  const at = Math.min(stop, count - 1);
  const rove = (event: KeyboardEvent<HTMLDivElement>) => {
    const move = ROVING_KEYS.get(event.key);
    // Note that only a press's own keys move the stop, never one heard on its way up from the Turn into menu.
    const from =
      event.target instanceof HTMLButtonElement ? buttons.current.indexOf(event.target) : -1;
    if (move === undefined || from < 0) return;
    event.preventDefault();
    const next = move(from, count);
    setStop(next);
    buttons.current[next]?.focus();
  };
  let index = 0;
  return (
    <MenuSurface
      ref={ref}
      className="luke-format-toolbar"
      flow={MENU_SURFACE_FLOW.TOOLBAR}
      role="toolbar"
      aria-label={FORMAT_TOOLBAR_WORDS.GROUP}
      onKeyDown={rove}
    >
      {groups.map((group, groupAt) => (
        <Fragment key={group[0]?.key}>
          {groupAt === 0 ? null : <span className="luke-format-toolbar-rule" aria-hidden="true" />}
          {group.map((press) => {
            const mine = index;
            index += 1;
            return (
              <Fragment key={press.key}>
                {press.draw({
                  ref: (button) => {
                    buttons.current[mine] = button;
                  },
                  tabbable: mine === at,
                  onFocus: () => setStop(mine),
                })}
              </Fragment>
            );
          })}
        </Fragment>
      ))}
    </MenuSurface>
  );
}
