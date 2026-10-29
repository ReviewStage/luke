/**
 * expanding-cards.tsx -- a list of cards, each opening into its detail over the list, the card itself travelling there and back: Motion's shared layout (`layoutId`) on the spring the tokens fit.
 *
 * A trial of Motion beside `ListMotion` and `picture-expand.ts`, which play
 * the same kind of move by hand. A card and the detail it opens into are two
 * elements sharing one layout id, the card's own namespaced by its key
 * (`LayoutGroup`'s `id`), so Motion carries the one box from the card's
 * rect to the detail's and back. Only the box arriving is drawn on the way
 * (no crossfade), so one card is seen to travel rather than two passing
 * through each other, the title riding along as one line. The layout lands at
 * once: the box travels by transform alone, and every element holding words
 * or a glyph travels by position alone (`layout="position"`), so no line of words is
 * drawn at a size between its two, and none reflows mid-motion. Motion
 * keeps the corners round while the box is scaled by writing each frame's
 * radius, which is paint and no layout; the corners it reads are the radius
 * roles, the card's a control's and the detail's a card's.
 *
 * Every timing is read from the tokens as they stand when the press lands
 * (`token-spring.ts`): the box on `--luke-spring` over
 * `--luke-duration-shape`, the detail's words arriving over
 * `--luke-duration-quick`. Closing, the detail's words leave first, over
 * `--luke-duration-exit`, and only then does the card travel home, so the
 * detail is never taken out on the frame it was closed. Reduced motion and a
 * capture run zero those, and the detail opens and closes at once.
 *
 * Each card is a `CardPress`, so the keyboard opens it as the pointer does.
 * The detail takes the keyboard onto its close button; Escape or that
 * button closes it, and the keyboard goes back to the card it opened from.
 */

import { AnimatePresence, LayoutGroup, type MotionStyle, type Transition } from "motion/react";
import * as m from "motion/react-m";
import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconButton } from "../components/button/button.js";
import { CardPress } from "../components/card-press/card-press.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../components/text/text.js";
import { CloseIcon } from "../face/glyphs.js";
import { MOTION_TOKEN, motionHeld } from "../motion-timing.js";
import { SpringScope } from "./spring-scope.js";
import { HELD_TRANSITION, tokenFade, tokenSpring } from "./token-spring.js";

/**
 * The layout ids a card shares with its detail, inside the card's own group.
 * Note that both titles hug their words, because Motion lines two boxes up by
 * their centres, and a title stretched to its card would cross its twin.
 */
const SHARED = {
  FRAME: "frame",
  TITLE: "title",
} as const;

/** The radius roles the two boxes stand at, read as pixels, since Motion mixes a radius only in pixels. */
const CORNER_TOKEN = {
  CARD: "--luke-control-radius",
  DETAIL: "--luke-card-radius",
} as const;

/** A card's frame: a raised ground a whole-card press covers. */
const CARD =
  "relative flex rounded-control flex-col gap-tight-gap border border-border-strong bg-background px-list-inset py-row-inset";

/**
 * The detail's frame, over the list it opened from: in the list's own grid
 * cell, so it stands at least as tall as the list and the stage grows to
 * hold a detail taller than the list, a one-card list's among them.
 */
const DETAIL =
  "relative z-1 col-start-1 row-start-1 flex rounded-card flex-col gap-field-gap overflow-clip border border-border-strong bg-background p-card-snug shadow-toast";

/** One card: what it is called, a line under it, and what its detail says. */
export interface ExpandingCard {
  readonly id: string;
  readonly title: string;
  readonly meta: string;
  readonly detail: string;
}

/** What a move plays on, read from the tokens as the press lands. */
interface Timing {
  readonly held: boolean;
  readonly travel: Transition;
  readonly arrive: Transition;
  readonly leave: Transition;
  readonly cardCorner: string | undefined;
  readonly detailCorner: string | undefined;
}

/**
 * What the cards stand at before the tokens are read: nothing moving, and
 * corners left to the stylesheet. Note that a corner is left unsaid rather
 * than empty, because Motion keeps the first value a box was drawn with.
 */
const AT_REST: Timing = {
  held: true,
  travel: HELD_TRANSITION,
  arrive: HELD_TRANSITION,
  leave: HELD_TRANSITION,
  cardCorner: undefined,
  detailCorner: undefined,
};

/**
 * The layout a box shares with its other half, and the travel between them:
 * none where motion is held still, so the detail stands at once rather than
 * drawing a frame at the card's rect first.
 */
function sharedLayout(
  id: string,
  timing: Timing,
): { layoutId?: string; layoutCrossfade?: boolean; transition?: Transition } {
  return timing.held ? {} : { layoutId: id, layoutCrossfade: false, transition: timing.travel };
}

/** The style a box's corner is drawn at, where it has been read. */
function cornerStyle(radius: string | undefined): MotionStyle {
  return radius === undefined ? {} : { borderRadius: radius };
}

/** The timing a move plays on at `element`, as its tokens stand there now. */
function timingAt(element: Element): Timing {
  const style = getComputedStyle(element);
  return {
    held: motionHeld(element),
    travel: tokenSpring(element, MOTION_TOKEN.DURATION_SHAPE, MOTION_TOKEN.SPRING),
    arrive: tokenFade(element, MOTION_TOKEN.DURATION_QUICK, MOTION_TOKEN.EASE_EXIT),
    leave: tokenFade(element, MOTION_TOKEN.DURATION_EXIT, MOTION_TOKEN.EASE_EXIT),
    cardCorner: style.getPropertyValue(CORNER_TOKEN.CARD).trim(),
    detailCorner: style.getPropertyValue(CORNER_TOKEN.DETAIL).trim(),
  };
}

/** The detail a card opened into, over the list, taking the keyboard onto its close; closing, its words leave before it goes. */
function Detail({
  card,
  timing,
  closing,
  closeLabel,
  onClose,
  onLeft,
}: {
  card: ExpandingCard;
  timing: Timing;
  closing: boolean;
  closeLabel: string;
  onClose: () => void;
  /** Told its words have left, which is when the card may travel home. */
  onLeft: () => void;
}): React.JSX.Element {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), []);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    onClose();
  };
  return (
    <m.section
      {...sharedLayout(SHARED.FRAME, timing)}
      style={cornerStyle(timing.detailCorner)}
      className={DETAIL}
      aria-label={card.title}
      onKeyDown={onKeyDown}
    >
      <div className="flex items-start justify-between gap-control-gap">
        <m.span layout="position" {...sharedLayout(SHARED.TITLE, timing)}>
          <Text variant={TEXT_VARIANT.LABEL} as={TEXT_ELEMENT.H3}>
            {card.title}
          </Text>
        </m.span>
        <m.span layout="position">
          <IconButton ref={close} icon={<CloseIcon />} label={closeLabel} onClick={onClose} />
        </m.span>
      </div>
      <m.div
        layout="position"
        initial={{ opacity: 0 }}
        animate={
          closing
            ? { opacity: 0, transition: timing.leave }
            : { opacity: 1, transition: timing.arrive }
        }
        onAnimationComplete={() => {
          if (closing) onLeft();
        }}
      >
        <Text variant={TEXT_VARIANT.BODY}>{card.detail}</Text>
      </m.div>
    </m.section>
  );
}

/** One card in the list, its press handing itself on so the keyboard can come back to it. */
function CardRow({
  card,
  timing,
  onOpen,
}: {
  card: ExpandingCard;
  timing: Timing;
  onOpen: (id: string, press: HTMLButtonElement | null) => void;
}): React.JSX.Element {
  const press = useRef<HTMLButtonElement>(null);
  return (
    <LayoutGroup id={card.id}>
      <m.div
        {...sharedLayout(SHARED.FRAME, timing)}
        style={cornerStyle(timing.cardCorner)}
        className={CARD}
      >
        <CardPress ref={press} onPress={() => onOpen(card.id, press.current)}>
          <m.span layout="position" className="self-start" {...sharedLayout(SHARED.TITLE, timing)}>
            <Text variant={TEXT_VARIANT.LABEL} as={TEXT_ELEMENT.SPAN}>
              {card.title}
            </Text>
          </m.span>
        </CardPress>
        <m.span layout="position">
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {card.meta}
          </Text>
        </m.span>
      </m.div>
    </LayoutGroup>
  );
}

/** The cards, each opening into its detail over them as it is pressed. */
export function ExpandingCards({
  cards,
  closeLabel,
}: {
  cards: readonly ExpandingCard[];
  /** The detail's close button's name. */
  closeLabel: string;
}): React.JSX.Element {
  const stage = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const [opened, setOpened] = useState<string | undefined>(undefined);
  const [closing, setClosing] = useState(false);
  const [timing, setTiming] = useState<Timing>(AT_REST);
  // Note that the corners are read before any press, because Motion mixes a radius from the one the card last stood at.
  useLayoutEffect(() => {
    if (stage.current !== null) setTiming(timingAt(stage.current));
  }, []);
  const read = () => {
    if (stage.current !== null) setTiming(timingAt(stage.current));
  };
  const open = (id: string, press: HTMLButtonElement | null) => {
    opener.current = press;
    read();
    setClosing(false);
    setOpened(id);
  };
  const close = () => {
    read();
    setClosing(true);
  };
  // Note that the keyboard goes back once the list is no longer inert, which is the render after the close.
  useEffect(() => {
    if (opened === undefined) opener.current?.focus();
  }, [opened]);
  const shown = cards.find((card) => card.id === opened);
  return (
    <SpringScope>
      <div ref={stage} className="grid">
        <ul
          className="col-start-1 row-start-1 m-0 flex list-none flex-col gap-list-gap p-0"
          inert={shown !== undefined}
        >
          {cards.map((card) => (
            <li key={card.id}>
              <CardRow card={card} timing={timing} onOpen={open} />
            </li>
          ))}
        </ul>
        <AnimatePresence>
          {shown === undefined ? null : (
            <LayoutGroup id={shown.id} key={shown.id}>
              <Detail
                card={shown}
                timing={timing}
                closing={closing}
                closeLabel={closeLabel}
                onClose={close}
                onLeft={() => setOpened(undefined)}
              />
            </LayoutGroup>
          )}
        </AnimatePresence>
      </div>
    </SpringScope>
  );
}
