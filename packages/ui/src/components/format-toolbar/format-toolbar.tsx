import {
  APP_COMMAND,
  SHORTCUT_KEY,
  type ShortcutChord,
  WRITING_MARK,
  WRITING_SHORTCUTS,
  type WritingBlock,
  type WritingMark,
  type WritingShortcut,
} from "@repo/settings/shortcuts";
import { Fragment, type ReactNode, type Ref, useMemo } from "react";
import { ChevronDownIcon } from "../../face/glyphs.js";
import { CommentAddIcon } from "../../icons/lucide-glyphs.js";
import { joinRefs } from "../../join-refs.js";
import { Button, IconButton } from "../button/button.js";
import { dropBelowStart, useMenu } from "../menu/menu.js";
import { MENU_SURFACE_FLOW, MenuSurface } from "../menu/menu-surface.js";
import { ROVING_ORIENTATION, useRovingKeys } from "../roving-keys/roving-keys.js";
import { Tooltip } from "../tooltip/hint.js";
import { TurnIntoMenu } from "../turn-into-menu/turn-into-menu.js";
import { WritingGlyph } from "../writing-glyph/writing-glyph.js";

const FORMAT_TOOLBAR_WORDS = {
  GROUP: "Formatting",
  TURN_INTO: "Turn into",
  COMMENT: "Comment",
} as const;

const MARK_GROUPS: readonly (readonly WritingMark[])[] = [
  [WRITING_MARK.BOLD, WRITING_MARK.ITALIC, WRITING_MARK.STRIKE, WRITING_MARK.CODE],
  [WRITING_MARK.LINK],
];

const LINK_CHORD: ShortcutChord = { key: SHORTCUT_KEY.K };

interface Press {
  readonly key: string;
  readonly draw: () => ReactNode;
}

export interface FormatToolbarTurnInto {
  readonly current: WritingBlock | undefined;
  readonly onTurn: (block: WritingBlock) => void;
}

function markChord(mark: WritingMark): ShortcutChord | undefined {
  const shortcut: WritingShortcut = WRITING_SHORTCUTS[mark];
  return mark === WRITING_MARK.LINK ? LINK_CHORD : shortcut.chord;
}

function TurnIntoPress({ turnInto }: { turnInto: FormatToolbarTurnInto }): React.JSX.Element {
  const menu = useMenu(true);
  const block =
    turnInto.current === undefined ? undefined : WRITING_SHORTCUTS[turnInto.current].label;
  return (
    <>
      <Tooltip label={FORMAT_TOOLBAR_WORDS.TURN_INTO}>
        <Button
          roving
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
            draw: () => <TurnIntoPress turnInto={turnInto} />,
          },
        ];
  const comment: Press[] =
    onComment === undefined
      ? []
      : [
          {
            key: FORMAT_TOOLBAR_WORDS.COMMENT,
            draw: () => (
              <Tooltip
                label={FORMAT_TOOLBAR_WORDS.COMMENT}
                command={APP_COMMAND.COMMENT_ON_SELECTION}
              >
                <Button roving keepFocus icon={<CommentAddIcon />} onClick={onComment}>
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
        draw: () => (
          <Tooltip label={WRITING_SHORTCUTS[mark].label} chord={markChord(mark)}>
            <IconButton
              roving
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

export function FormatToolbar({
  marks,
  onMark,
  turnInto,
  onComment,
  ref,
}: {
  marks: readonly WritingMark[];
  onMark: (mark: WritingMark) => void;
  turnInto?: FormatToolbarTurnInto | undefined;
  onComment?: (() => void) | undefined;
  ref?: Ref<HTMLDivElement> | undefined;
}): React.JSX.Element {
  const roving = useRovingKeys<HTMLDivElement>({ orientation: ROVING_ORIENTATION.HORIZONTAL });
  const box = useMemo(() => joinRefs(ref, roving.ref), [ref, roving.ref]);
  const groups = pressGroups({ marks, onMark, turnInto, onComment });
  return (
    <MenuSurface
      {...roving}
      ref={box}
      className="ui-format-toolbar"
      flow={MENU_SURFACE_FLOW.TOOLBAR}
      role="toolbar"
      aria-label={FORMAT_TOOLBAR_WORDS.GROUP}
    >
      {groups.map((group, groupAt) => (
        <Fragment key={group[0]?.key}>
          {groupAt === 0 ? null : <span className="ui-format-toolbar-rule" aria-hidden="true" />}
          {group.map((press) => (
            <Fragment key={press.key}>{press.draw()}</Fragment>
          ))}
        </Fragment>
      ))}
    </MenuSurface>
  );
}
