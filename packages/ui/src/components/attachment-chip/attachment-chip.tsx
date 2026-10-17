import type { ReactNode } from "react";
import { RemoveIcon } from "../../face/glyphs.js";

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
 * A chip is one item of a list its caller draws and names, so the caller
 * owns the row's layout; the chip takes no class or style.
 */

/** A file as a chip: a thumbnail or a glyph and name, with its open and its way off where given. */
export function AttachmentChip({
  name,
  image,
  icon,
  detail,
  onOpen,
  onRemove,
  removeDisabled,
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
}): React.JSX.Element {
  const face =
    image === undefined ? (
      <>
        {icon}
        <span className="luke-attachment-chip-name">{name}</span>
        {detail === undefined ? null : (
          <span className="luke-attachment-chip-detail">{detail}</span>
        )}
      </>
    ) : (
      <img src={image} alt={name} />
    );
  return (
    <li
      className="luke-attachment-chip"
      data-image={image === undefined ? undefined : "true"}
      title={name}
    >
      {onOpen === undefined ? (
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
