import { useAtomSet } from "@effect/atom-react";
import { Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon } from "../../face/glyphs.js";
import { GLYPH } from "../../icons/glyph-registry.js";
import { type ButtonSize, IconButton } from "../button/button.js";
import { CHIP_CUT, CHIP_LOOK, CHIP_SIZE, Chip, ChipName } from "../chip/chip.js";
import { TOAST_HOLD } from "../toast/toast.js";
import { Tooltip } from "../tooltip/hint.js";
import { VisuallyHidden } from "../visually-hidden/visually-hidden.js";

/**
 * copy-button.tsx -- the window's one Copy: a glyph button named "Copy {what}" that copies the words it is given and answers on itself.
 *
 * Every copy button wears the copy glyph (`GLYPH.COPY`) and is named for
 * what it copies, "Copy code" or "Copy link", which its hint says too. A
 * press hands its words to the copy act its caller passes in, the shell's
 * clipboard, so this package reaches no platform of its own. Once the act
 * answers, the glyph turns to the check, the one a landed button shows, in
 * the success colour, and a polite line says "Copied"; a clipboard that
 * refused turns it to the alert, in the danger colour, and an alert says
 * so. Either stands for the toast's short hold (`TOAST_HOLD.DONE`), so a
 * copy answered on its button and one answered by a toast last the same,
 * then the copy glyph comes back. Its name stays as it was throughout, so
 * nothing beside it shifts, and only its hint says what came of the copy
 * while the answer stands.
 *
 * A copy button comes in two looks (`look`): the glyph button, which is its
 * own face, and a chip (`COPY_LOOK.CHIP`) for a name that is shown and
 * copied, a pull request's branch: the compact pill's face, the words it
 * copies in the code face, cut in their middle where long, with its own
 * glyph (`lead`) before them. The lead stands at rest; under the pointer or
 * the keyboard it gives way to the copy glyph, saying what a press does,
 * and the answer's check or alert stands in the same square for its hold,
 * so the chip never moves. A chip's hint is the whole name at rest.
 *
 * A second press starts the hold over from its own answer, and only the
 * last press's answer is shown, however the clipboard orders them. The hold
 * is an atom's work on the registry the app's root provides, as a hint's
 * rest is (`../tooltip/hint.tsx`), so nothing here arms a timer of its own
 * and a test moves it on a faked clock.
 */

/** The looks a copy button comes in: a glyph alone, or a chip that names what it copies. */
export const COPY_LOOK = {
  ICON: "icon",
  CHIP: "chip",
} as const;

export type CopyLook = (typeof COPY_LOOK)[keyof typeof COPY_LOOK];

/** What a copy button shows: its resting glyph, the check, or the alert. */
const COPY_STATE = {
  IDLE: "idle",
  COPIED: "copied",
  FAILED: "failed",
} as const;

type CopyState = (typeof COPY_STATE)[keyof typeof COPY_STATE];

/** What a copy button's hint, and its reader's line, say while its answer stands. */
const COPY_ANSWER = {
  [COPY_STATE.COPIED]: "Copied",
  [COPY_STATE.FAILED]: "Could not copy",
} as const;

/** The glyph each state draws. */
const COPY_GLYPH = {
  [COPY_STATE.IDLE]: GLYPH.COPY,
  [COPY_STATE.COPIED]: CheckIcon,
  [COPY_STATE.FAILED]: GLYPH.FAILED,
} as const;

/**
 * One button's hold, as an atom whose work is the wait: it hands the glyph
 * back once the hold has run out. A new answer starts it afresh, and an
 * interrupt calls it off. Note that the way to say so is handed inside a
 * record, because a function handed to an atom's setter is read as an update
 * of its value and called at once.
 */
function copyHold() {
  return Atom.fn(({ settle }: { readonly settle: () => void }) =>
    Effect.andThen(Effect.sleep(TOAST_HOLD.DONE), Effect.sync(settle)),
  );
}

/** The name of a copy button: "code" makes "Copy code". */
function copyLabel(what: string): string {
  return `Copy ${what}`;
}

/**
 * The glyph for `state`, keyed by how many times it has turned, so each
 * turn springs the new glyph in and the first draw stands still.
 */
function CopyGlyph({ state, turns }: { state: CopyState; turns: number }): React.JSX.Element {
  const Drawn = COPY_GLYPH[state];
  return (
    <span
      key={turns}
      className="luke-copy-glyph"
      data-state={state}
      data-turned={turns > 0 || undefined}
      aria-hidden="true"
    >
      <Drawn />
    </span>
  );
}

/** What every copy button takes, whatever its look. */
interface CopyButtonBase {
  /** The words a press copies. */
  text: string;
  /** What it copies, as a sentence goes on after "Copy": "code", "link", "lines". */
  what: string;
  /** The caller's platform act that puts words on the clipboard; a rejection is a refused copy. */
  copy: (text: string) => Promise<void>;
  /** Whether there is nothing to copy now. */
  disabled?: boolean | undefined;
}

export type CopyButtonProps = CopyButtonBase &
  (
    | {
        look?: typeof COPY_LOOK.ICON | undefined;
        size?: ButtonSize | undefined;
      }
    | {
        /** A chip names `text` itself, in the code face, so it is drawn for a name. */
        look: typeof COPY_LOOK.CHIP;
        /** The glyph a chip leads with at rest: a branch's. */
        lead: () => React.JSX.Element;
      }
  );

/** A chip's lead: its own glyph at rest, the copy's own answer in the same square under the pointer, the keyboard, and once it lands. */
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
      className="luke-copy-lead inline-grid size-chip-chevron flex-none text-muted-foreground [&_svg]:size-chip-chevron"
      data-state={state}
    >
      <span className="luke-copy-lead-mark" aria-hidden="true">
        <Lead />
      </span>
      <CopyGlyph state={state} turns={turns} />
    </span>
  );
}

/** A button that copies `text` through `copy`, named "Copy {what}", and shows what came of it. */
export function CopyButton(props: CopyButtonProps): React.JSX.Element {
  const { text, what, copy, disabled } = props;
  const label = copyLabel(what);
  const hold = useAtomSet(useMemo(copyHold, []));
  const [shown, setShown] = useState<{ readonly state: CopyState; readonly turns: number }>({
    state: COPY_STATE.IDLE,
    turns: 0,
  });
  // Note that this is a ref, because an answer reads it as it lands, which
  // no render stands between; leaving bumps it, so a late answer lands nowhere.
  const latest = useRef(0);
  useEffect(
    () => () => {
      latest.current += 1;
      hold(Atom.Interrupt);
    },
    [hold],
  );
  const turn = (state: CopyState) => setShown((was) => ({ state, turns: was.turns + 1 }));
  const press = () => {
    latest.current += 1;
    const pressed = latest.current;
    const answer = (state: CopyState) => {
      if (pressed !== latest.current) return;
      turn(state);
      hold({ settle: () => turn(COPY_STATE.IDLE) });
    };
    // Note that the act is called within the press, because a browser's
    // clipboard takes a write only while the press's activation stands, and
    // one that throws before it hands a promise back is a refused copy too.
    let copying: Promise<void>;
    try {
      copying = copy(text);
    } catch (refusal) {
      copying = Promise.reject(refusal);
    }
    copying.then(
      () => answer(COPY_STATE.COPIED),
      () => answer(COPY_STATE.FAILED),
    );
  };
  const { state, turns } = shown;
  const hint = state === COPY_STATE.IDLE ? label : COPY_ANSWER[state];
  const answers = (
    <>
      <VisuallyHidden role="status">
        {state === COPY_STATE.COPIED ? COPY_ANSWER[state] : ""}
      </VisuallyHidden>
      <VisuallyHidden role="alert">
        {state === COPY_STATE.FAILED ? COPY_ANSWER[state] : ""}
      </VisuallyHidden>
    </>
  );
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
          {answers}
        </Chip>
      </Tooltip>
    );
  }
  return (
    <Tooltip label={hint}>
      <IconButton
        icon={
          <>
            <CopyGlyph state={state} turns={turns} />
            {answers}
          </>
        }
        label={label}
        {...(props.size === undefined ? {} : { size: props.size })}
        disabled={disabled}
        onClick={press}
      />
    </Tooltip>
  );
}
