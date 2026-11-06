import { GLYPH } from "../../icons/glyph-registry.js";
import { CameraIcon, ImageUpIcon } from "../../icons/icons.js";
import { ReplayMask } from "../../session-replay-marks.js";
import { AVATAR_SHAPE, AVATAR_SIZE, Avatar } from "../avatar/avatar.js";
import type { FilePicker } from "../file-picker/file-picker.js";
import { Menu, useMenu } from "../menu/menu.js";
import { Tooltip } from "../tooltip/hint.js";

const PICK_WORDS = {
  ADD: "Add photo",
  CHANGE: "Change photo",
  REPLACE: "Replace photo",
  REMOVE: "Remove photo",
} as const;

const TILE =
  "ui-photo-pick group/photo relative m-0 inline-flex size-avatar-card flex-none items-center justify-center overflow-hidden rounded-avatar-tile border-0 bg-transparent p-0 text-muted-foreground cursor-press disabled:cursor-default disabled:opacity-disabled data-[blank=true]:border data-[blank=true]:border-dashed data-[blank=true]:border-border-strong data-[blank=true]:bg-well [&_svg]:size-control-icon";

const OVER =
  "ui-photo-pick-over absolute inset-0 flex items-center justify-center bg-veil text-on-veil opacity-0 transition-opacity duration-(--ui-duration-hover) ease-plain group-hover/photo:opacity-100 group-focus-visible/photo:opacity-100";

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
  id?: string | undefined;
  photo: string | undefined;
  picker: FilePicker;
  onRemove?: (() => void) | undefined;
  disabled?: boolean | undefined;
}): React.JSX.Element {
  const named = name.trim();
  const blank = named === "" && photo === undefined;
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
