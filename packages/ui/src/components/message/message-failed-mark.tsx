/**
 * message-failed-mark.tsx -- the red alert beside a message that did not go: pressed, its menu says why and offers what mends it, as a chat app's red mark beside a bubble does.
 *
 * A message that did not go stays where it went, its bubble faded, and this
 * mark stands at its side, the danger ink on a quiet button
 * (`BUTTON_VARIANT.DANGER_QUIET`), so one red glyph says what a row of
 * buttons under every such bubble would. Its menu is headed by why the
 * message did not go and offers the caller's acts on it, Retry first, and,
 * where the failure is the app's, Copy details last in a group of its own,
 * as a failure note offers it. The mark says the failure was shown as it is
 * drawn and hidden as it goes, which reports it once (`FailureCopy`'s
 * `useFailureDetails`), so a failure drawn here is reported as one drawn in
 * a note is.
 */

import { GLYPH } from "../../icons/glyph-registry.js";
import { isReported, type ReportedFailure, type Unreported } from "../../reported-failure.js";
import { BUTTON_VARIANT, IconButton } from "../button/button.js";
import { useFailureDetails } from "../failure-copy/failure-copy.js";
import { Menu, type MenuEntry, useMenu } from "../menu/menu.js";

/** What Copy details is called, as a failure note's copy is named. */
const COPY_DETAILS = "Copy details";

/** The mark beside a message that did not go, named `label`, whose menu is headed by `reason` and offers `groups`, then Copy details where `failure` is the app's. */
export function MessageFailedMark({
  label,
  reason,
  groups,
  failure,
  replayUnmasked = false,
}: {
  /** What the mark says, its accessible name and its menu's: "Not delivered". */
  label: string;
  /** Why the message did not go, which heads the menu. */
  reason: string;
  /** The acts on the message, in groups, a rule between each. */
  groups: readonly (readonly MenuEntry[])[];
  /** The failure beneath it, reported as the mark first stands; words that are no failure of the app's offer nothing to copy. */
  failure: ReportedFailure | Unreported | undefined;
  /** Whether the reason and the acts are the app's own words, which a screen recording shows as they read. */
  replayUnmasked?: boolean | undefined;
}): React.JSX.Element {
  const menu = useMenu(true);
  const reported = isReported(failure) ? failure : undefined;
  const details = useFailureDetails(reported);
  const copy: readonly (readonly MenuEntry[])[] =
    reported === undefined || details === undefined
      ? []
      : [[{ label: COPY_DETAILS, icon: <GLYPH.COPY />, onSelect: () => reported.copy(details) }]];
  return (
    <>
      <IconButton
        label={label}
        variant={BUTTON_VARIANT.DANGER_QUIET}
        icon={<GLYPH.FAILED />}
        {...menu.trigger()}
      />
      {menu.drawn === undefined ? null : (
        <Menu
          label={label}
          heading={reason}
          menu={menu.drawn}
          groups={[...groups, ...copy]}
          onClose={menu.close}
          replayUnmasked={replayUnmasked}
        />
      )}
    </>
  );
}
