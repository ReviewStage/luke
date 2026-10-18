import type { ReactNode } from "react";
import { BUTTON_VARIANT, Button } from "../button/button.js";
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
 * given, the one way on from the place as a quiet button. It fills the room
 * its container leaves it and stands a little above that room's middle,
 * where the eye takes the middle to be, scrolling rather than overflowing
 * where the room is shorter than it.
 */

/** The one way on from an empty place: a press, named by its words. */
export interface EmptyStateAction {
  readonly label: string;
  /** The glyph before its words, where one says what the press does. */
  readonly icon?: ReactNode;
  readonly onClick: () => void;
  /** Whether the press is unavailable for now, as the same act elsewhere on the page is. */
  readonly disabled?: boolean | undefined;
}

/**
 * A place with nothing in it yet: `icon`, the place's own glyph, drawn large
 * and muted over `title` where one is given, over the line `children` says,
 * over `action` where one is given; one alert where `alert` says a failure
 * left it empty.
 */
export function EmptyState({
  icon,
  title,
  action,
  alert = false,
  children,
}: {
  icon: ReactNode;
  title?: string | undefined;
  action?: EmptyStateAction | undefined;
  alert?: boolean | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="luke-empty-state">
      <div className="luke-empty-state-body" role={alert ? "alert" : undefined}>
        <span className="luke-empty-state-icon" aria-hidden="true">
          {icon}
        </span>
        <div className="luke-empty-state-words">
          {title === undefined ? null : (
            <Text as={TEXT_ELEMENT.H3} variant={TEXT_VARIANT.LABEL}>
              {title}
            </Text>
          )}
          <Text tone={TEXT_TONE.MUTED}>{children}</Text>
        </div>
        {action === undefined ? null : (
          <Button
            variant={BUTTON_VARIANT.QUIET}
            icon={action.icon}
            disabled={action.disabled}
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        )}
      </div>
    </div>
  );
}
