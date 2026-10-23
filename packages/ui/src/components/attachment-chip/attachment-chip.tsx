import { type ReactNode, useState } from "react";
import { cssCustomProperties } from "../../css.js";
import { CheckIcon, RemoveIcon } from "../../face/glyphs.js";
import { pulseOnPress } from "../../press-pulse.js";
import { motionKey as motionKeyAttribute } from "../list-motion/list-motion.js";
import { ClippedLine, ONE_LINE_ELEMENT, ONE_LINE_END } from "../one-line/clipped-line.js";
import { SPINNER_SIZE, Spinner } from "../spinner/spinner.js";

/**
 * attachment-chip.tsx -- a file coming along with a message or a note, as a chip: its thumbnail, or its type's glyph, its name, and its size.
 *
 * A picture is its thumbnail alone; any other file is the glyph its caller
 * draws for its type, its name fading out at the chip's end, and what more
 * the caller says of it (its size). The chip's face is the press that opens
 * the file where `onOpen` is given, named "Open <name>"; a file with nothing
 * to open is drawn the same, pressing nothing. Where `onRemove` is given the
 * chip carries its way off on its corner, a real button named
 * "Remove <name>", unavailable while `removeDisabled` holds, which its
 * caller answers at once, so the file is off on the press. A chip with a way
 * off was added to what it comes along with, so it springs in as it arrives;
 * its exit is the list's that draws it, a `ListMotion` following it by its
 * `motionKey`, which plays its arrival in its place, since its caller has
 * already let it go.
 *
 * A file whose bytes are still read stands as a thumbnail's place holding
 * the spinner, said to a reader as reading the file. One that failed to
 * come stands as its caller's glyph for the failure (a picture gone), with
 * why in words where the caller says (`failure`, "Not kept") and what more
 * it says of it (its size). Neither opens anything.
 *
 * A file on its way up is drawn as it will stand, with a meter along its
 * foot: filling to `progress` where its caller can say how far the bytes
 * have gone, and sweeping where it cannot, as a send that carries its files
 * inside one request cannot. It opens nothing until it is up. One that goes
 * up while drawn takes a check that springs in on its corner and, after a
 * beat, fades, so a file seen going up is seen landing; one drawn up already
 * stands still.
 *
 * A chip is one item of a list its caller draws and names, so the caller
 * owns the row's layout; the chip takes no class or style.
 */

/** Where a chip's file stands: here to open, still read, on its way up, or failed to come. */
export const ATTACHMENT_CHIP_STATE = {
  READY: "ready",
  LOADING: "loading",
  UPLOADING: "uploading",
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
  const drawn = state === ATTACHMENT_CHIP_STATE.READY || state === ATTACHMENT_CHIP_STATE.UPLOADING;
  if (drawn && image !== undefined) {
    return <img src={image} alt={name} />;
  }
  const words = state === ATTACHMENT_CHIP_STATE.FAILED ? failure : name;
  return (
    <>
      {icon}
      {words === undefined ? null : (
        <ClippedLine
          className="luke-attachment-chip-name"
          as={ONE_LINE_ELEMENT.SPAN}
          end={ONE_LINE_END.FADE}
          words={words}
        >
          {words}
        </ClippedLine>
      )}
      {detail === undefined ? null : <span className="luke-attachment-chip-detail">{detail}</span>}
    </>
  );
}

/** The share of an upload done, as a fraction held to 0–1, a value that is not a number read as none. */
function fractionOf(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(100, Math.max(0, progress)) / 100;
}

/** The meter along an uploading chip's foot: filled to its share where one is known, else sweeping. */
function UploadMeter({
  name,
  progress,
}: {
  name: string;
  progress: number | undefined;
}): React.JSX.Element {
  const fraction = progress === undefined ? undefined : fractionOf(progress);
  return (
    <span
      className="luke-attachment-chip-meter"
      role="progressbar"
      aria-label={`Uploading ${name}`}
      aria-valuemin={fraction === undefined ? undefined : 0}
      aria-valuemax={fraction === undefined ? undefined : 100}
      aria-valuenow={fraction === undefined ? undefined : Math.round(fraction * 100)}
      data-indeterminate={fraction === undefined ? "true" : undefined}
    >
      <span
        className="luke-attachment-chip-meter-fill"
        style={
          fraction === undefined
            ? undefined
            : cssCustomProperties({ "--luke-attachment-chip-share": fraction })
        }
      />
    </span>
  );
}

/** Whether the chip's file went up while it was drawn: true from the render that sees it land. */
function useLanded(state: AttachmentChipState): boolean {
  const [was, setWas] = useState(state);
  const [landed, setLanded] = useState(false);
  // Note that the change is taken in the render that sees it, so the check
  // springs in on the frame the meter goes.
  if (state !== was) {
    setWas(state);
    setLanded(was === ATTACHMENT_CHIP_STATE.UPLOADING && state === ATTACHMENT_CHIP_STATE.READY);
  }
  return landed;
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
  progress,
  failure,
  motionKey,
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
  /** Where the file stands; a chip still read, uploading, or failed opens nothing. */
  state?: AttachmentChipState;
  /** How far an upload has come, in percent, where its transport can say; an uploading chip without it sweeps. */
  progress?: number | undefined;
  /** Why a failed file is not there, in words ("Not kept"); its glyph alone says so where none is given. */
  failure?: string | undefined;
  /** The key a `ListMotion` around its list follows it by, which plays its arrival and its exit. */
  motionKey?: string | undefined;
}): React.JSX.Element {
  const ready = state === ATTACHMENT_CHIP_STATE.READY;
  const uploading = state === ATTACHMENT_CHIP_STATE.UPLOADING;
  const landed = useLanded(state);
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
    ((ready || uploading) && image !== undefined) ||
    state === ATTACHMENT_CHIP_STATE.LOADING ||
    (state === ATTACHMENT_CHIP_STATE.FAILED && failure === undefined && detail === undefined);
  return (
    <li
      className="luke-attachment-chip"
      data-image={thumbnail ? "true" : undefined}
      data-removable={onRemove === undefined ? undefined : "true"}
      {...(motionKey === undefined ? {} : motionKeyAttribute(motionKey))}
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
          onClick={pulseOnPress(onOpen)}
        >
          {face}
        </button>
      )}
      {uploading ? <UploadMeter name={name} progress={progress} /> : null}
      {landed ? (
        <span className="luke-attachment-chip-landed" aria-hidden="true">
          <CheckIcon />
        </span>
      ) : null}
      {onRemove === undefined ? null : (
        <button
          type="button"
          className="luke-attachment-chip-remove"
          aria-label={`Remove ${name}`}
          disabled={removeDisabled === true}
          onClick={pulseOnPress(onRemove)}
        >
          <RemoveIcon />
        </button>
      )}
    </li>
  );
}
