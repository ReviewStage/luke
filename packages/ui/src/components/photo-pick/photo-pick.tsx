import { GLYPH } from "../../icons/glyph-registry.js";
import { CameraIcon, ImageUpIcon } from "../../icons/icons.js";
import { ReplayMask } from "../../session-replay-marks.js";
import { AVATAR_SHAPE, AVATAR_SIZE, Avatar } from "../avatar/avatar.js";
import type { FilePicker } from "../file-picker/file-picker.js";
import { Menu, useMenu } from "../menu/menu.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * photo-pick.tsx -- a thing's photo as its own tile, the tile itself the press that picks one, beside the name it stands for.
 *
 * The tile is what the thing is marked by wherever it is listed: its photo,
 * or its name's letter on its hue until one stands, so the person sees the
 * tile they are making as they make it; dashed around a camera while
 * nothing is named, the camera laid over the tile under the pointer or the
 * keyboard's focus once something is. A press picks a photo; with one set,
 * which its caller says by offering its removal (`onRemove`), a press opens
 * Replace photo and Remove photo instead. A finger's tap is its press. The caller holds
 * the picker and the photo, since what a picked file becomes is the
 * caller's to decide, and the picker's hidden input is drawn here, beside
 * the tile. Note that the words it is named by are a hint on a rest, since
 * the tile says what it is by itself.
 */

/** What a press on the tile does, said as its name and its hint. */
const PICK_WORDS = {
  ADD: "Add photo",
  CHANGE: "Change photo",
  REPLACE: "Replace photo",
  REMOVE: "Remove photo",
} as const;

/** The tile as a press: a workspace tile's box and corner, lighting its camera under the pointer or the keyboard's focus. */
const TILE =
  "ui-photo-pick group/photo relative m-0 inline-flex size-avatar-card flex-none items-center justify-center overflow-hidden rounded-avatar-tile border-0 bg-transparent p-0 text-muted-foreground cursor-press disabled:cursor-default disabled:opacity-disabled data-[blank=true]:border data-[blank=true]:border-dashed data-[blank=true]:border-border-strong data-[blank=true]:bg-well [&_svg]:size-control-icon";

/** The camera laid over a tile that stands, shown under the pointer or the keyboard's focus. */
const OVER =
  "ui-photo-pick-over absolute inset-0 flex items-center justify-center bg-veil text-on-veil opacity-0 transition-opacity duration-(--ui-duration-hover) ease-plain group-hover/photo:opacity-100 group-focus-visible/photo:opacity-100";

/** The photo of `name`, picked through `picker`; `unnamed` is the name its tile says while none is typed. */
export function PhotoPick({
  name,
  unnamed,
  id,
  photo,
  picker,
  onRemove,
  disabled = false,
}: {
  name: string;
  unnamed: string;
  /** What the tile's hue is kept by, as the thing's tile is drawn wherever it is listed; its name where none is given. */
  id?: string | undefined;
  /** The photo's URL, or nothing while none is picked. */
  photo: string | undefined;
  picker: FilePicker;
  /** Removes the photo set, given only while one is, offered beside Replace photo; without it a press picks. */
  onRemove?: (() => void) | undefined;
  disabled?: boolean | undefined;
}): React.JSX.Element {
  const named = name.trim();
  const blank = named === "" && photo === undefined;
  // Note that a photo set is told by its removal being offered, because the photo's own picture may still be on its way.
  const choosing = onRemove !== undefined;
  const menu = useMenu(choosing);
  const label = photo === undefined && !choosing ? PICK_WORDS.ADD : PICK_WORDS.CHANGE;
  const press = choosing ? menu.trigger() : { onClick: picker.open };
  return (
    <>
      <Tooltip label={label}>
        <button
          type="button"
          className={TILE}
          aria-label={label}
          disabled={disabled}
          data-blank={blank ? "true" : undefined}
          {...press}
        >
          {blank ? (
            <CameraIcon aria-hidden="true" />
          ) : (
            <>
              <ReplayMask>
                <Avatar
                  name={named === "" ? unnamed : named}
                  {...(id === undefined ? {} : { id })}
                  src={photo}
                  size={AVATAR_SIZE.CARD}
                  shape={AVATAR_SHAPE.TILE}
                  decorative
                />
              </ReplayMask>
              <span className={OVER} aria-hidden="true">
                <CameraIcon />
              </span>
            </>
          )}
        </button>
      </Tooltip>
      {menu.drawn === undefined || onRemove === undefined ? null : (
        <Menu
          label={label}
          menu={menu.drawn}
          groups={[
            [{ label: PICK_WORDS.REPLACE, icon: <ImageUpIcon />, onSelect: picker.open }],
            [
              {
                label: PICK_WORDS.REMOVE,
                icon: <GLYPH.REMOVE />,
                danger: true,
                onSelect: onRemove,
              },
            ],
          ]}
          onClose={menu.close}
          replayUnmasked
        />
      )}
      {picker.input}
    </>
  );
}
