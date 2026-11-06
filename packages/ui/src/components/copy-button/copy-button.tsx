import { useAtomSet } from "@effect/atom-react";
import { Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon } from "../../face/glyphs.js";
import { GLYPH } from "../../icons/glyph-registry.js";
import { ANNOUNCE, type Announce, announce, type Retire } from "../announcer/announcer.js";
import { type ButtonSize, IconButton } from "../button/button.js";
import { CHIP_CUT, CHIP_LOOK, CHIP_SIZE, Chip, ChipName } from "../chip/chip.js";
import { TOAST_HOLD } from "../toast/toast.js";
import { Tooltip } from "../tooltip/hint.js";

export const COPY_LOOK = {
  ICON: "icon",
  CHIP: "chip",
} as const;

export type CopyLook = (typeof COPY_LOOK)[keyof typeof COPY_LOOK];

const COPY_STATE = {
  IDLE: "idle",
  COPIED: "copied",
  FAILED: "failed",
} as const;

type CopyState = (typeof COPY_STATE)[keyof typeof COPY_STATE];

const COPY_ANSWER = {
  [COPY_STATE.COPIED]: "Copied",
  [COPY_STATE.FAILED]: "Could not copy",
} as const;

const COPY_SAID = {
  [COPY_STATE.COPIED]: ANNOUNCE.POLITE,
  [COPY_STATE.FAILED]: ANNOUNCE.ALERT,
} as const satisfies Record<keyof typeof COPY_ANSWER, Announce>;

const COPY_GLYPH = {
  [COPY_STATE.IDLE]: GLYPH.COPY,
  [COPY_STATE.COPIED]: CheckIcon,
  [COPY_STATE.FAILED]: GLYPH.FAILED,
} as const;

function copyHold() {
  return Atom.fn(({ settle }: { readonly settle: () => void }) =>
    Effect.andThen(Effect.sleep(TOAST_HOLD.DONE), Effect.sync(settle)),
  );
}

function copyLabel(what: string): string {
  return `Copy ${what}`;
}

const GLYPH_INK = {
  [COPY_STATE.IDLE]: "",
  [COPY_STATE.COPIED]: " text-complete",
  [COPY_STATE.FAILED]: " text-danger",
} as const satisfies Record<CopyState, string>;

function CopyGlyph({ state, turns }: { state: CopyState; turns: number }): React.JSX.Element {
  const Drawn = COPY_GLYPH[state];
  return (
    <span
      key={turns}
      className={`ui-copy-glyph inline-grid flex-none place-items-center${GLYPH_INK[state]}`}
      data-state={state}
      data-turned={turns > 0 || undefined}
      aria-hidden="true"
    >
      <Drawn />
    </span>
  );
}

interface CopyButtonBase {
  text: string;
  what: string;
  copy: (text: string) => Promise<void>;
  disabled?: boolean | undefined;
}

export type CopyButtonProps = CopyButtonBase &
  (
    | {
        look?: typeof COPY_LOOK.ICON | undefined;
        size?: ButtonSize | undefined;
      }
    | {
        look: typeof COPY_LOOK.CHIP;
        lead: () => React.JSX.Element;
      }
  );

function ChipLead({
  Lead,
  state,
  turns,
}: {
  Lead: () => React.JSX.Element;
  state: CopyState;
  turns: number;
}): React.JSX.Element {
  return (
    <span
      className="ui-copy-lead inline-grid size-chip-chevron flex-none text-muted-foreground *:[grid-area:1/1] *:place-self-center *:transition-opacity *:duration-(--ui-duration-quick) *:ease-motion-exit [&_svg]:size-chip-chevron"
      data-state={state}
    >
      <span className="ui-copy-lead-mark" aria-hidden="true">
        <Lead />
      </span>
      <CopyGlyph state={state} turns={turns} />
    </span>
  );
}

export function CopyButton(props: CopyButtonProps): React.JSX.Element {
  const { text, what, copy, disabled } = props;
  const label = copyLabel(what);
  const hold = useAtomSet(useMemo(copyHold, []));
  const [shown, setShown] = useState<{ readonly state: CopyState; readonly turns: number }>({
    state: COPY_STATE.IDLE,
    turns: 0,
  });
  const latest = useRef(0);
  const said = useRef<Retire>(() => undefined);
  useEffect(
    () => () => {
      latest.current += 1;
      hold(Atom.Interrupt);
      said.current();
    },
    [hold],
  );
  const turn = (state: CopyState) => setShown((was) => ({ state, turns: was.turns + 1 }));
  const press = () => {
    latest.current += 1;
    const pressed = latest.current;
    const answer = (state: keyof typeof COPY_ANSWER) => {
      if (pressed !== latest.current) return;
      turn(state);
      said.current();
      said.current = announce(COPY_SAID[state], COPY_ANSWER[state]);
      hold({
        settle: () => {
          turn(COPY_STATE.IDLE);
          said.current();
        },
      });
    };
    let asked: Promise<void>;
    try {
      asked = copy(text);
    } catch (refusal) {
      asked = Promise.reject(refusal);
    }
    asked.then(
      () => answer(COPY_STATE.COPIED),
      () => answer(COPY_STATE.FAILED),
    );
  };
  const { state, turns } = shown;
  const hint = state === COPY_STATE.IDLE ? label : COPY_ANSWER[state];
  if (props.look === COPY_LOOK.CHIP) {
    return (
      <Tooltip label={state === COPY_STATE.IDLE ? text : COPY_ANSWER[state]}>
        <Chip
          look={CHIP_LOOK.PILL}
          size={CHIP_SIZE.COMPACT}
          aria-label={label}
          disabled={disabled}
          onClick={press}
        >
          <ChipLead Lead={props.lead} state={state} turns={turns} />
          <ChipName mono cut={CHIP_CUT.MIDDLE}>
            {text}
          </ChipName>
        </Chip>
      </Tooltip>
    );
  }
  return (
    <Tooltip label={hint}>
      <IconButton
        icon={<CopyGlyph state={state} turns={turns} />}
        label={label}
        {...(props.size === undefined ? {} : { size: props.size })}
        disabled={disabled}
        onClick={press}
      />
    </Tooltip>
  );
}
