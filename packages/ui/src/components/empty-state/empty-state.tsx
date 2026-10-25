import type { ReactNode } from "react";
import { Empty, EmptyHeader, EmptyMedia } from "../../shadcn/empty.js";
import { BUTTON_VARIANT, Button, type ButtonVariant } from "../button/button.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";

/**
 * empty-state.tsx -- a whole place with nothing in it yet: a large, muted glyph of what belongs there above one short line.
 *
 * Only a whole tab, pane, or page that stands empty draws one, or one whose
 * thing cannot be shown, and only where the glyph says what will stand
 * there, or that what would have stood there did not land. A small note
 * inside a list, a menu, or a search with no match says its line alone, as
 * does a wait. The glyph is the place's own, so the empty place reads as the
 * place it is. A place a failure left empty (`ErrorState` alone in its
 * region) is an `alert`, so a reader hears it land, and its way on is Retry.
 *
 * Every empty state is one layout: the glyph, a heading where the line alone
 * would not say what the place is, the line, and under it, where one is
 * given, the one way on from the place as a quiet button, or the primary
 * one where that press is the whole point of the place (`look`), as a
 * Generate is where nothing stands until it is pressed. It fills the room
 * its container leaves it and stands a little above that room's middle,
 * where the eye takes the middle to be, scrolling rather than overflowing
 * where the room is shorter than it.
 *
 * It is drawn by shadcn/ui's empty (`../../shadcn/empty.tsx`) in Tailwind
 * utilities over the theme: the block, its glyph, and its words are the
 * vendored parts, and the room around the block is this component's own,
 * its space above and below shared two to three by the room's `::before`
 * and `::after`.
 */

/**
 * The room an empty place fills. Note that the room above the state and the
 * room below it are shared two to three, so it stands where the eye takes
 * the middle to be, and that where the room is shorter than the state both
 * shares are nothing and the state scrolls rather than run under what
 * stands above it. Each share's basis is nothing rather than a percentage,
 * which a room of no set height would read as the content's.
 */
const ROOM =
  "luke-empty-state flex min-h-0 flex-[1_1_0] flex-col items-center overflow-x-hidden overflow-y-auto before:flex-[2_1_0] after:flex-[3_1_0]";

/** How the way on from an empty place is drawn: quiet, or primary where the press is what the place is for. */
export const EMPTY_STATE_ACTION_LOOK = {
  QUIET: "quiet",
  PRIMARY: "primary",
} as const;

export type EmptyStateActionLook =
  (typeof EMPTY_STATE_ACTION_LOOK)[keyof typeof EMPTY_STATE_ACTION_LOOK];

/** The look each way on is drawn in, as a button. */
const ACTION_BUTTON = {
  [EMPTY_STATE_ACTION_LOOK.QUIET]: BUTTON_VARIANT.QUIET,
  [EMPTY_STATE_ACTION_LOOK.PRIMARY]: BUTTON_VARIANT.PRIMARY,
} as const satisfies Record<EmptyStateActionLook, ButtonVariant>;

/** The one way on from an empty place: a press, named by its words. */
export interface EmptyStateAction {
  readonly label: string;
  /** How it is drawn; quiet where none is named. */
  readonly look?: EmptyStateActionLook | undefined;
  /** The glyph before its words, where one says what the press does. */
  readonly icon?: ReactNode;
  readonly onClick: () => void;
  /** Whether the press is unavailable for now, as the same act elsewhere on the page is. */
  readonly disabled?: boolean | undefined;
  /** Whether its glyph turns once as a press lands, as a retry's arrow does. */
  readonly turns?: boolean | undefined;
}

/**
 * A place with nothing in it yet: `icon`, the place's own glyph (left out only
 * where a place has none to say), drawn large and muted over `title` where one is given, over the line `children` says,
 * over `action` where one is given; one alert where `alert` says a failure
 * left it empty.
 */
export function EmptyState({
  icon,
  title,
  action,
  secondary,
  alert = false,
  children,
}: {
  icon?: ReactNode;
  title?: string | undefined;
  action?: EmptyStateAction | undefined;
  /** A second way on, under the first, where the place offers two (Retry, then Close). */
  secondary?: EmptyStateAction | undefined;
  alert?: boolean | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className={ROOM}>
      <Empty role={alert ? "alert" : undefined}>
        {icon === undefined ? null : <EmptyMedia aria-hidden="true">{icon}</EmptyMedia>}
        <EmptyHeader>
          {title === undefined ? null : (
            <Text as={TEXT_ELEMENT.H3} variant={TEXT_VARIANT.LABEL}>
              {title}
            </Text>
          )}
          <Text tone={TEXT_TONE.MUTED}>{children}</Text>
        </EmptyHeader>
        {[action, secondary].map((way) =>
          way === undefined ? null : (
            <Button
              key={way.label}
              variant={ACTION_BUTTON[way.look ?? EMPTY_STATE_ACTION_LOOK.QUIET]}
              icon={way.icon}
              disabled={way.disabled}
              turns={way.turns}
              onClick={way.onClick}
            >
              {way.label}
            </Button>
          ),
        )}
      </Empty>
    </div>
  );
}
