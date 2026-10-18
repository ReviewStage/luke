import type { ReactNode } from "react";
import { RemoveIcon } from "../../face/glyphs.js";
import { SPINNER_SIZE, Spinner } from "../spinner/spinner.js";

/**
 * attachment-chip.tsx -- a file coming along with a message or a note, as a chip: its thumbnail, or its type's glyph, its name, and its size.
 *
 * A picture is its thumbnail alone; any other file is the glyph its caller
 * draws for its type, its name cut short at the chip's end, and what more
 * the caller says of it (its size). The chip's face is the press that opens
 * the file where `onOpen` is given, named "Open <name>"; a file with nothing
 * to open is drawn the same, pressing nothing. Where `onRemove` is given the
 * chip carries its way off on its corner, a real button named
 * "Remove <name>", unavailable while `removeDisabled` holds.
 *
 * A file whose bytes are still read stands as a thumbnail's place holding
 * the spinner, said to a reader as reading the file. One that failed to
 * come stands as its caller's glyph for the failure (a picture gone), with
 * why in words where the caller says (`failure`, "Not kept") and what more
 * it says of it (its size). Neither opens anything.
 *
 * A chip is one item of a list its caller draws and names, so the caller
 * owns the row's layout; the chip takes no class or style.
 */

/** Where a chip's file stands: here to open, still read, or failed to come. */
export const ATTACHMENT_CHIP_STATE = {
  READY: "ready",
  LOADING: "loading",
  FAILED: "failed",
} as const;

export type AttachmentChipState =
  (typeof ATTACHMENT_CHIP_STATE)[keyof typeof ATTACHMENT_CHIP_STATE];

/** What a chip's face holds for its file as it stands. */
function ChipFace({
  state,
  name,
  image,
  icon,
  detail,
  failure,
}: {
  state: AttachmentChipState;
  name: string;
  image: string | undefined;
  icon: ReactNode;
  detail: string | undefined;
  failure: string | undefined;
}): React.JSX.Element {
  if (state === ATTACHMENT_CHIP_STATE.LOADING) {
    return <Spinner label={`Reading ${name}`} size={SPINNER_SIZE.INLINE} />;
  }
  if (state === ATTACHMENT_CHIP_STATE.READY && image !== undefined) {
    return <img src={image} alt={name} />;
  }
  const words = state === ATTACHMENT_CHIP_STATE.FAILED ? failure : name;
  return (
    <>
      {icon}
      {words === undefined ? null : <span className="luke-attachment-chip-name">{words}</span>}
      {detail === undefined ? null : <span className="luke-attachment-chip-detail">{detail}</span>}
    </>
  );
}

/** A file as a chip: a thumbnail or a glyph and name, with its open and its way off where given. */
export function AttachmentChip({
  name,
  image,
  icon,
  detail,
  onOpen,
  onRemove,
  removeDisabled,
  state = ATTACHMENT_CHIP_STATE.READY,
  failure,
}: {
  /** The file's name, which names the chip, its open, and its way off. */
  name: string;
  /** The address of the picture to draw as its thumbnail, for a picture with bytes to draw. */
  image?: string | undefined;
  /** The glyph for a file drawn by name, its type's. */
  icon?: ReactNode;
  /** What more the chip says of a file drawn by name, after it (its size). */
  detail?: string | undefined;
  /** Opens the file; a chip without it presses nothing. */
  onOpen?: (() => void) | undefined;
  /** Takes the file off; a chip without it has no way off. */
  onRemove?: (() => void) | undefined;
  /** Whether the way off stands unavailable, while what the file is for is busy. */
  removeDisabled?: boolean | undefined;
  /** Where the file stands; a chip still read or failed opens nothing. */
  state?: AttachmentChipState;
  /** Why a failed file is not there, in words ("Not kept"); its glyph alone says so where none is given. */
  failure?: string | undefined;
}): React.JSX.Element {
  const ready = state === ATTACHMENT_CHIP_STATE.READY;
  const face = (
    <ChipFace
      state={state}
      name={name}
      image={image}
      icon={icon}
      detail={detail}
      failure={failure}
    />
  );
  // A thumbnail's place: a picture, a wait, or a failure with no words.
  const thumbnail =
    (ready && image !== undefined) ||
    state === ATTACHMENT_CHIP_STATE.LOADING ||
    (state === ATTACHMENT_CHIP_STATE.FAILED && failure === undefined && detail === undefined);
  return (
    <li
      className="luke-attachment-chip"
      data-image={thumbnail ? "true" : undefined}
      data-state={state}
      title={name}
    >
      {onOpen === undefined || !ready ? (
        <span className="luke-attachment-chip-face">{face}</span>
      ) : (
        <button
          type="button"
          className="luke-attachment-chip-face"
          aria-label={`Open ${name}`}
          onClick={onOpen}
        >
          {face}
        </button>
      )}
      {onRemove === undefined ? null : (
        <button
          type="button"
          className="luke-attachment-chip-remove"
          aria-label={`Remove ${name}`}
          disabled={removeDisabled === true}
          onClick={onRemove}
        >
          <RemoveIcon />
        </button>
      )}
    </li>
  );
}
