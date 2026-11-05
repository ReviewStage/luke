import {
  CHIP_LOOK,
  CHIP_SIZE,
  Chip,
  ChipName,
  type FootRow,
  type MenuRow,
  POPOVER_ALIGN,
  SearchableMenu,
  STATUS_TONE,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { useDisclosure } from "@repo/ui/use-disclosure";
import { useId, useRef, useState } from "react";

/**
 * relation-kind-pill.tsx -- a relation's kind leading a related task's row: a compact pill by the kind's icon, its words, and a chevron, dropping the kinds and Remove relation.
 *
 * The plan's Task relations group leads each row with it (`plan-relations.tsx`),
 * in the attention tone for a blocker still open, and New task's rows over
 * its card lead with it too (`new-task-relation.tsx`), each over its own
 * kinds: the plan's as the open task stands to the other, New task's as the
 * new task will. A press drops, from the pill's start, the kinds, the current
 * one checked, a kind the task cannot take dimmed with why, and Remove
 * relation pinned under them; a pick hands the kind back, and focus goes back to the pill as a native menu hands it back to its
 * button.
 */

/** What the pill's menu names the kinds and the relation's taking away. */
const WORDS = {
  CHANGE: "Change relation",
  REMOVE: "Remove relation",
  NO_MATCH: "No kinds match",
} as const;

/** The pinned row's id, apart from every kind's. */
const REMOVE_ROW_ID = "remove-relation";

export function RelationKindPill<Kind extends string>({
  kind,
  kinds,
  words,
  icon,
  why,
  attention = false,
  disabled = false,
  onChange,
  onRemove,
}: {
  kind: Kind;
  /** The kinds the menu offers, in its order. */
  kinds: readonly Kind[];
  /** Each kind as the pill and its menu name it. */
  words: Readonly<Record<Kind, string>>;
  /** Each kind's icon, which leads the pill and its row in the menu. */
  icon: (kind: Kind) => React.JSX.Element;
  /** Why the task cannot take a kind, which dims its row in the menu with why; none where every kind may be picked. */
  why?: ((kind: Kind) => string | undefined) | undefined;
  /** Whether the relation still asks for attention: a blocker not yet done. */
  attention?: boolean | undefined;
  /** Whether the pill is held, as while New task's start is out. */
  disabled?: boolean | undefined;
  onChange: (to: Kind) => void;
  onRemove: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const drawn = useDisclosure(open);
  const menuId = useId();
  const box = useRef<HTMLSpanElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const rows: readonly MenuRow[] = kinds.map((each) => {
    const whyNot = each === kind ? undefined : why?.(each);
    return {
      id: each,
      label: words[each],
      icon: icon(each),
      ...(whyNot === undefined ? {} : { disabled: whyNot }),
    };
  });
  // Note that we hand focus back to the pill, as a native menu returns it to its button, because closing takes the focused menu away.
  const close = () => {
    setOpen(false);
    chip.current?.focus();
  };
  const foot: readonly FootRow[] = [
    {
      id: REMOVE_ROW_ID,
      label: WORDS.REMOVE,
      icon: <GLYPH.CLOSE />,
      onPress: () => {
        close();
        onRemove();
      },
    },
  ];
  return (
    <span className="relation-kind-pill relative inline-flex items-center" ref={box}>
      <Chip
        ref={chip}
        look={CHIP_LOOK.PILL}
        size={CHIP_SIZE.COMPACT}
        tone={attention ? STATUS_TONE.ATTENTION : undefined}
        chevron
        disabled={disabled}
        aria-label={`Relation: ${words[kind]}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (!disabled) setOpen(!open);
        }}
      >
        {icon(kind)}
        <ChipName>
          <ReplayUnmask>{words[kind]}</ReplayUnmask>
        </ChipName>
      </Chip>
      {drawn.mounted ? (
        <SearchableMenu
          replayUnmasked
          leaving={drawn.leaving}
          ref={drawn.ref}
          id={menuId}
          label={WORDS.CHANGE}
          rows={rows}
          value={kind}
          foot={foot}
          noMatch={WORDS.NO_MATCH}
          align={POPOVER_ALIGN.START}
          onPick={(id) => {
            close();
            const picked = kinds.find((each) => each === id);
            if (picked !== undefined) onChange(picked);
          }}
          onClose={close}
          onLeave={(left) => {
            if (!(left instanceof Node && box.current?.contains(left))) setOpen(false);
          }}
        />
      ) : null}
    </span>
  );
}
