import { CloseIcon } from "../../face/glyphs.js";
import { BUTTON_SIZE, BUTTON_VARIANT, Button, ButtonLink, IconButton } from "../button/button.js";
import { CopyButton } from "../copy-button/copy-button.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * toast-actions.tsx -- what stands at a toast's end when it carries an action or a copy: the action's outline button, the window's copy button, and a × that dismisses it.
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
 *
 * A toast saying a failure may carry its details to copy (`copy`), drawn as
 * the window's one copy button after the action, its glyph alone so the
 * toast's words keep their room. A press of it copies and answers on the
 * button itself, as every copy button does, and leaves the toast standing,
 * so an action beside it is never lost to a copy.
 */

/** What a toast's copy button copies, named "Copy {what}", through its caller's clipboard (`CopyButton`). */
export interface ToastCopy {
  readonly text: string;
  readonly what: string;
  readonly copy: (text: string) => Promise<void>;
}

/** A toast's action, where it carries one: its label and press, and the page it opens, where it opens one. */
type ToastActionProps =
  | {
      label: string;
      /** The page the action opens, where it opens one: drawn as a link rather than a button. */
      href?: string | undefined;
      onPress: () => void;
    }
  | { label?: never; href?: never; onPress?: never };

/** A toast's copy, action, and dismiss: what it copies, the action's label and press, the dismiss's label, and what dismissing does. */
export function ToastActions({
  label,
  href,
  onPress,
  copy,
  dismissLabel,
  onDismiss,
}: ToastActionProps & {
  /** The details a press of its copy button copies, where it says a failure. */
  copy?: ToastCopy | undefined;
  /** What the × is called, for whoever cannot see it. */
  dismissLabel: string;
  onDismiss: () => void;
}): React.JSX.Element {
  return (
    <>
      {label === undefined ? null : href === undefined ? (
        <Button
          variant={BUTTON_VARIANT.OUTLINE}
          onClick={() => {
            onDismiss();
            onPress?.();
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
            onPress?.();
          }}
        >
          {label}
        </ButtonLink>
      )}
      {copy === undefined ? null : (
        <CopyButton text={copy.text} what={copy.what} copy={copy.copy} />
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
