import { CloseIcon } from "../../face/glyphs.js";
import { BUTTON_SIZE, BUTTON_VARIANT, Button, ButtonLink, IconButton } from "../button/button.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * toast-actions.tsx -- what stands at a toast's end when it carries an action: the action's outline button, and a × that dismisses it.
 *
 * The × is a disc over the card's top-left corner, shown under the pointer or
 * focus as a Mac's own notifications show theirs (and at rest on a screen
 * with no hover), so it takes no room in the row: the action stands at the
 * card's end and the words never reflow as it comes.
 *
 * Pressing the action dismisses the toast first, then runs what it does. An
 * action that opens a page is given its `href` and drawn as a link in the
 * same outline look, so a right-click and a reader's link list find it;
 * its press stops the browser's follow, since `onPress` is the window's own
 * door for opening the address.
 */

/** A toast's action and its dismiss: the action's label and press, the dismiss's label, and what dismissing does. */
export function ToastActions({
  label,
  href,
  onPress,
  dismissLabel,
  onDismiss,
}: {
  label: string;
  /** The page the action opens, where it opens one: drawn as a link rather than a button. */
  href?: string | undefined;
  onPress: () => void;
  /** What the × is called, for whoever cannot see it. */
  dismissLabel: string;
  onDismiss: () => void;
}): React.JSX.Element {
  return (
    <>
      {href === undefined ? (
        <Button
          variant={BUTTON_VARIANT.OUTLINE}
          onClick={() => {
            onDismiss();
            onPress();
          }}
        >
          {label}
        </Button>
      ) : (
        <ButtonLink
          variant={BUTTON_VARIANT.OUTLINE}
          href={href}
          onClick={(event) => {
            event.preventDefault();
            onDismiss();
            onPress();
          }}
        >
          {label}
        </ButtonLink>
      )}
      <span className="luke-toast-dismiss absolute -top-toast-gap -left-toast-gap flex rounded-full border border-border-strong bg-background shadow-toast-dismiss">
        <Tooltip label={dismissLabel}>
          <IconButton
            icon={<CloseIcon />}
            label={dismissLabel}
            size={BUTTON_SIZE.COMPACT}
            onClick={onDismiss}
          />
        </Tooltip>
      </span>
    </>
  );
}
