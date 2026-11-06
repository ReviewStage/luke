import type { ReactNode } from "react";
import { GLYPH } from "../../icons/glyph-registry.js";
import { BackButton, NO_BACK_KEY } from "../back-button/back-button.js";
import { IconButton } from "../button/button.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";

/**
 * dialog-head.tsx -- the head a step of a flow draws in its dialog: back at its start, its title and a line under it, and close at its end.
 *
 * A dialog that is one step of a flow opened from another surface, a
 * connection begun from a settings row, draws its own head rather than the
 * card's title, so it can stand a way back and a way out beside its title:
 * the one way back (`BackButton`) at the head's start, which leads to the
 * surface the flow was opened from and names it, and the close glyph at its end, which ends the flow.
 * Both are the owner's to carry out. The title names the card (its `id` is
 * what the dialog's `labelledBy` names), set in the dialog's heading type,
 * and a line under it says what the flow is for in the muted ink.
 */

/** Back, `title` named by `titleId`, close, and `subtitle` under the title. */
export function DialogHead({
  titleId,
  title,
  subtitle,
  backLabel,
  backTo,
  closeLabel,
  onBack,
  onClose,
}: {
  /** The id the dialog's `labelledBy` names the card by. */
  titleId: string;
  title: string;
  subtitle?: ReactNode;
  /** Back's words ("Back"). */
  backLabel: string;
  /** The place back leads to, as a sentence names it mid-way ("Codex"), which its hint reads. */
  backTo: string;
  closeLabel: string;
  onBack: () => void;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <div className="ui-dialog-head flex flex-col gap-tight-gap">
      <div className="flex items-center gap-control-gap">
        <BackButton label={backLabel} place={backTo} command={NO_BACK_KEY} onBack={onBack} />
        <Text
          as={TEXT_ELEMENT.H2}
          variant={TEXT_VARIANT.DIALOG}
          id={titleId}
          className="min-w-0 flex-1"
        >
          {title}
        </Text>
        <IconButton icon={<GLYPH.CLOSE />} label={closeLabel} onClick={onClose} />
      </div>
      {subtitle === undefined ? null : (
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {subtitle}
        </Text>
      )}
    </div>
  );
}
