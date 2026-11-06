import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import { notePictureOrigin } from "../../picture-expand.js";
import { PRESS_PULSE, pulsePress } from "../../press-pulse.js";

export const PICTURE_TILE_FACE = {
  FRAMED: "framed",
  ROUND: "round",
} as const;

export type PictureTileFace = (typeof PICTURE_TILE_FACE)[keyof typeof PICTURE_TILE_FACE];

const ENLARGE_LABEL = "Enlarge";

const TILE =
  "ui-picture-tile group/picture-tile relative m-0 flex w-fit min-w-0 max-w-full cursor-zoom-in flex-col gap-ui-4 border-0 bg-transparent p-0 text-start text-inherit [font:inherit] data-[fill=true]:w-full data-[pointer-opens=false]:cursor-auto";

const FACE =
  "ui-picture-tile-face relative block min-w-0 max-w-full rounded-control data-[face=round]:rounded-full transition-transform duration-(--ui-duration-fast) ease-spring-fast group-active/picture-tile:[transform:scale(0.98)] group-data-[pointer-opens=false]/picture-tile:group-active/picture-tile:[transform:none]";

type HintProps = Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  | "onPointerEnter"
  | "onPointerLeave"
  | "onPointerDown"
  | "onClick"
  | "onTouchEnd"
  | "onFocus"
  | "onBlur"
  | "aria-describedby"
  | "aria-keyshortcuts"
>;

export function PictureTile({
  name,
  onOpen,
  fill = false,
  face = PICTURE_TILE_FACE.FRAMED,
  pointerOpens = true,
  caption,
  children,
  onClick,
  ...hinted
}: HintProps & {
  name: string;
  onOpen: (event: MouseEvent<HTMLButtonElement>) => void;
  fill?: boolean | undefined;
  face?: PictureTileFace | undefined;
  pointerOpens?: boolean | undefined;
  caption?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={TILE}
      data-fill={fill}
      data-pointer-opens={pointerOpens}
      aria-label={name === "" ? ENLARGE_LABEL : `${ENLARGE_LABEL} ${name}`}
      {...hinted}
      onClick={(event) => {
        onClick?.(event);
        if (!pointerOpens && event.detail > 0) return;
        const pressed = event.currentTarget.querySelector<HTMLElement>(".ui-picture-tile-face");
        if (pressed !== null) {
          pulsePress(pressed, PRESS_PULSE.QUIET);
          notePictureOrigin(pressed);
        }
        onOpen(event);
      }}
    >
      <span className={FACE} data-face={face} data-focus-ring="">
        {children}
      </span>
      {caption}
    </button>
  );
}
