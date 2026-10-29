/**
 * fling-stack.tsx -- a stack of notices, each flung away sideways: dragged, it follows the pointer; let go, it carries the speed it was let go at, off its side or back home, and the notices under it close the gap.
 *
 * A trial of Motion's drag beside `toast-swipe.ts`, which plays the same
 * gesture by hand. The difference is the release. The toast judges how far
 * it was dragged and springs from rest, so a quick flick that travelled
 * little springs back. Here a release is judged by where the notice would
 * be one `--luke-duration-fast` later at the speed it was let go at
 * (`tokenReach`), so a flick sends it however short, and the spring it then
 * plays starts at that speed (`tokenSpring`'s spring takes the value's own
 * velocity), so a fast fling leaves fast and a slow one drifts, and one let
 * go short of the line swings home with the speed it had. Past the line it
 * flies off its own width and is handed to its owner (`onDismiss`) as it
 * passes out of sight, never on the frame it was let go.
 *
 * The notice fades as it leaves its place, by how far of its own width it
 * stands from home, so opacity follows the hand rather than a clock. The
 * notices under it close the gap on `--luke-spring` over
 * `--luke-duration-shape`, Motion's layout animation, by transform alone.
 * Reduced motion and a capture run zero the tokens: a fling then carries
 * nowhere, so its distance alone decides, and every move lands at once.
 *
 * The pointer's way is the drag; the keyboard's is each notice's close
 * button, which plays the same flight from rest.
 */

import {
  AnimatePresence,
  animate,
  type PanInfo,
  type Transition,
  useMotionValue,
  useTransform,
} from "motion/react";
import * as m from "motion/react-m";
import { useRef, useState } from "react";
import { BUTTON_SIZE, IconButton } from "../components/button/button.js";
import { TEXT_VARIANT, Text } from "../components/text/text.js";
import { CloseIcon } from "../face/glyphs.js";
import { MOTION_TOKEN } from "../motion-timing.js";
import { SpringScope } from "./spring-scope.js";
import { HELD_TRANSITION, tokenReach, tokenSpring } from "./token-spring.js";

/** How much of its width a notice must land past, carried along its fling, to be sent away. */
const AWAY_SHARE = 0.4;

/** Which way a notice leaves by: its sign along the axis. */
const SIDE = {
  LEFT: -1,
  RIGHT: 1,
} as const;

type Side = (typeof SIDE)[keyof typeof SIDE];

/** A notice's card, drawn as a toast's is. */
const NOTICE =
  "flex cursor-grab touch-pan-y items-center gap-icon-gap rounded-toast border border-border-strong bg-background py-row-inset pr-tight-gap pl-list-inset shadow-toast active:cursor-grabbing";

/** One notice: what it says, keyed by what it is. */
export interface FlingNotice {
  readonly id: string;
  readonly words: string;
}

/** One notice, flung away by the pointer or sent by its close button. */
function Notice({
  notice,
  glide,
  dismissLabel,
  onAway,
}: {
  notice: FlingNotice;
  glide: Transition;
  dismissLabel: string;
  onAway: () => void;
}): React.JSX.Element {
  const card = useRef<HTMLLIElement>(null);
  const leaving = useRef(false);
  const x = useMotionValue(0);
  const opacity = useTransform(x, (offset) => {
    const width = card.current?.offsetWidth ?? 0;
    return width === 0 ? 1 : 1 - Math.min(1, Math.abs(offset) / width);
  });
  const spring = (element: HTMLElement) =>
    tokenSpring(element, MOTION_TOKEN.DURATION_FAST, MOTION_TOKEN.SPRING_FAST);
  const send = (side: Side, velocity: number) => {
    const element = card.current;
    if (element === null || leaving.current) return;
    leaving.current = true;
    const edge = element.offsetWidth;
    // Note that it is handed on as it passes out of sight, rather than once its spring comes to rest out there.
    const unwatch = x.on("change", (offset) => {
      if (Math.abs(offset) < edge) return;
      unwatch();
      onAway();
    });
    animate(x, side * edge, { ...spring(element), velocity });
  };
  const letGo = (_event: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) => {
    const element = card.current;
    if (element === null || leaving.current) return;
    const landing = x.get() + tokenReach(element, info.velocity.x);
    if (Math.abs(landing) >= element.offsetWidth * AWAY_SHARE) {
      send(landing < 0 ? SIDE.LEFT : SIDE.RIGHT, info.velocity.x);
      return;
    }
    animate(x, 0, { ...spring(element), velocity: info.velocity.x });
  };
  return (
    <m.li
      ref={card}
      layout="position"
      transition={{ layout: glide }}
      drag="x"
      dragMomentum={false}
      onDragEnd={letGo}
      style={{ x, opacity }}
      className={NOTICE}
    >
      <span className="min-w-0 flex-1">
        <Text variant={TEXT_VARIANT.LABEL}>{notice.words}</Text>
      </span>
      <IconButton
        icon={<CloseIcon />}
        label={dismissLabel}
        size={BUTTON_SIZE.COMPACT}
        onClick={() => send(SIDE.RIGHT, 0)}
      />
    </m.li>
  );
}

/** The notices, newest last, each flung away to dismiss it. */
export function FlingStack({
  notices,
  label,
  dismissLabel,
  onDismiss,
}: {
  notices: readonly FlingNotice[];
  /** The list's accessible name. */
  label: string;
  /** Each notice's close button's name. */
  dismissLabel: string;
  /** Told a notice has gone, once it is out of sight. */
  onDismiss: (id: string) => void;
}): React.JSX.Element {
  const list = useRef<HTMLOListElement>(null);
  const [glide, setGlide] = useState<Transition>(HELD_TRANSITION);
  const away = (id: string) => {
    // Note that the gap closes on the tokens as they stand when the notice goes, read in the render that removes it.
    if (list.current !== null) {
      setGlide(tokenSpring(list.current, MOTION_TOKEN.DURATION_SHAPE, MOTION_TOKEN.SPRING));
    }
    onDismiss(id);
  };
  return (
    <SpringScope>
      <ol ref={list} aria-label={label} className="m-0 flex list-none flex-col gap-list-gap p-0">
        <AnimatePresence initial={false} mode="popLayout">
          {notices.map((notice) => (
            <Notice
              key={notice.id}
              notice={notice}
              glide={glide}
              dismissLabel={dismissLabel}
              onAway={() => away(notice.id)}
            />
          ))}
        </AnimatePresence>
      </ol>
    </SpringScope>
  );
}
