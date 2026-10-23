import { CloseIcon } from "../../face/glyphs.js";
import { BUTTON_SIZE, BUTTON_VARIANT, Button, IconButton } from "../button/button.js";

/**
 * toast-actions.tsx -- what stands at a toast's end when it carries an action: the action's outline button, and a × that dismisses it.
 *
 * The × is a disc over the card's top-left corner, shown under the pointer or
 * focus as a Mac's own notifications show theirs (and at rest on a screen
 * with no hover), so it takes no room in the row: the action stands at the
 * card's end and the words never reflow as it comes.
 *
 * Pressing the action dismisses the toast first, then runs what it does.
 */

/** A toast's action and its dismiss: the action's label and press, the dismiss's label, and what dismissing does. */
export function ToastActions({
  label,
  onPress,
  dismissLabel,
  onDismiss,
}: {
  label: string;
  onPress: () => void;
  /** What the × is called, for whoever cannot see it. */
  dismissLabel: string;
  onDismiss: () => void;
}): React.JSX.Element {
  return (
    <>
      <Button
        variant={BUTTON_VARIANT.OUTLINE}
        onClick={() => {
          onDismiss();
          onPress();
        }}
      >
        {label}
      </Button>
      <span className="luke-toast-dismiss">
        <IconButton
          icon={<CloseIcon />}
          label={dismissLabel}
          size={BUTTON_SIZE.COMPACT}
          onClick={onDismiss}
        />
      </span>
    </>
  );
}
