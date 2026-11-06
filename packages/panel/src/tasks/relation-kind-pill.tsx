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

const WORDS = {
  CHANGE: "Change relation",
  REMOVE: "Remove relation",
  NO_MATCH: "No kinds match",
} as const;

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
  kinds: readonly Kind[];
  words: Readonly<Record<Kind, string>>;
  icon: (kind: Kind) => React.JSX.Element;
  why?: ((kind: Kind) => string | undefined) | undefined;
  attention?: boolean | undefined;
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
