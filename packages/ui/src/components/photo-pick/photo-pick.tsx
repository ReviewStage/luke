import { ReplayMask } from "../../session-replay-marks.js";
import { AVATAR_SHAPE, AVATAR_SIZE, Avatar } from "../avatar/avatar.js";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import type { FilePicker } from "../file-picker/file-picker.js";

/**
 * photo-pick.tsx -- a square photo picked for something being named, beside the button that picks it.
 *
 * The square stands once a name is typed or a photo is picked: the photo,
 * or the name's letter on its hue until one is, so the person sees the
 * tile they are making as they make it. The button says Add photo, then
 * Replace photo once one stands. The caller holds the picker and the
 * photo, since what a picked file becomes is the caller's to decide, and
 * draws the picker's hidden input here, beside its button.
 */

/** The button's words, before a photo is picked and after. */
const PICK_WORDS = {
  ADD: "Add photo",
  REPLACE: "Replace photo",
} as const;

/** The photo of `name`, picked through `picker`; `unnamed` is the name its square says while none is typed. */
export function PhotoPick({
  name,
  unnamed,
  photo,
  picker,
  disabled = false,
}: {
  name: string;
  unnamed: string;
  /** The picked photo's URL, or nothing before one is picked. */
  photo: string | undefined;
  picker: FilePicker;
  disabled?: boolean | undefined;
}): React.JSX.Element {
  const named = name.trim();
  return (
    <div className="flex items-center gap-control-gap">
      {named === "" && photo === undefined ? null : (
        <ReplayMask>
          <Avatar
            name={named === "" ? unnamed : named}
            src={photo}
            size={AVATAR_SIZE.CARD}
            shape={AVATAR_SHAPE.SQUARE}
            decorative
          />
        </ReplayMask>
      )}
      <Button variant={BUTTON_VARIANT.OUTLINE} disabled={disabled} onClick={picker.open}>
        {photo === undefined ? PICK_WORDS.ADD : PICK_WORDS.REPLACE}
      </Button>
      {picker.input}
    </div>
  );
}
