import { type ReactNode, useState, useSyncExternalStore } from "react";
import { identityHue, identityLetter } from "../../actor-model.js";
import { UserIcon } from "../../face/glyphs.js";
import { ReplayMask } from "../../session-replay-marks.js";
import {
  Avatar as ShadcnAvatar,
  AvatarFallback as ShadcnAvatarFallback,
  AvatarImage as ShadcnAvatarImage,
} from "../../shadcn/avatar.js";

export const AVATAR_SIZE = {
  MARK: "mark",
  INLINE: "inline",
  GLYPH: "glyph",
  STACK: "stack",
  ROW: "row",
  ACCOUNT: "account",
  CARD: "card",
  PAGE: "page",
  MASTHEAD: "masthead",
  PORTRAIT: "portrait",
} as const;

export type AvatarSize = (typeof AVATAR_SIZE)[keyof typeof AVATAR_SIZE];

export const AVATAR_SHAPE = {
  CIRCLE: "circle",
  SQUARE: "square",
  TILE: "tile",
} as const;

export type AvatarShape = (typeof AVATAR_SHAPE)[keyof typeof AVATAR_SHAPE];

const PICTURE = {
  LOADING: "loading",
  LOADED: "loaded",
  FAILED: "failed",
} as const;

type Picture = (typeof PICTURE)[keyof typeof PICTURE];

const SIZE_CLASS: Record<AvatarSize, string> = {
  [AVATAR_SIZE.MARK]: "size-avatar-mark text-[length:calc(var(--spacing-avatar-mark)*0.5)]",
  [AVATAR_SIZE.INLINE]: "size-avatar-inline text-[length:calc(var(--spacing-avatar-inline)*0.5)]",
  [AVATAR_SIZE.GLYPH]: "size-avatar-glyph text-[length:calc(var(--spacing-avatar-glyph)*0.5)]",
  [AVATAR_SIZE.STACK]: "size-avatar-stack text-[length:calc(var(--spacing-avatar-stack)*0.5)]",
  [AVATAR_SIZE.ROW]: "size-avatar-row text-[length:calc(var(--spacing-avatar-row)*0.5)]",
  [AVATAR_SIZE.ACCOUNT]:
    "size-avatar-account text-[length:calc(var(--spacing-avatar-account)*0.5)]",
  [AVATAR_SIZE.CARD]: "size-avatar-card text-[length:calc(var(--spacing-avatar-card)*0.5)]",
  [AVATAR_SIZE.PAGE]: "size-avatar-page text-[length:calc(var(--spacing-avatar-page)*0.5)]",
  [AVATAR_SIZE.MASTHEAD]:
    "size-avatar-masthead text-[length:calc(var(--spacing-avatar-masthead)*0.5)]",
  [AVATAR_SIZE.PORTRAIT]:
    "size-avatar-portrait text-[length:calc(var(--spacing-avatar-portrait)*0.5)]",
};

const BOX_CLASS: Record<AvatarSize, string> = {
  [AVATAR_SIZE.MARK]: "size-avatar-mark",
  [AVATAR_SIZE.INLINE]: "size-avatar-inline",
  [AVATAR_SIZE.GLYPH]: "size-avatar-glyph",
  [AVATAR_SIZE.STACK]: "size-avatar-stack",
  [AVATAR_SIZE.ROW]: "size-avatar-row",
  [AVATAR_SIZE.ACCOUNT]: "size-avatar-account",
  [AVATAR_SIZE.CARD]: "size-avatar-card",
  [AVATAR_SIZE.PAGE]: "size-avatar-page",
  [AVATAR_SIZE.MASTHEAD]: "size-avatar-masthead",
  [AVATAR_SIZE.PORTRAIT]: "size-avatar-portrait",
};

const SHAPE_CLASS: Record<AvatarShape, string> = {
  [AVATAR_SHAPE.CIRCLE]: "rounded-full after:rounded-full",
  [AVATAR_SHAPE.SQUARE]: "rounded-avatar-square after:rounded-avatar-square",
  [AVATAR_SHAPE.TILE]: "rounded-avatar-tile after:rounded-avatar-tile",
};

const HUE_CLASS: Readonly<Record<number, string>> = {
  1: "bg-identity-1",
  2: "bg-identity-2",
  3: "bg-identity-3",
  4: "bg-identity-4",
  5: "bg-identity-5",
  6: "bg-identity-6",
};

const GLYPH_BOX = "ui-avatar-glyph grid size-full place-items-center *:size-avatar-glyph-share";

interface Look {
  readonly size: AvatarSize;
  readonly shape: AvatarShape;
  readonly glyph: boolean;
  readonly tiled: boolean;
  readonly branded: boolean;
  readonly edged: boolean;
  readonly blank: boolean;
  readonly hue: number | undefined;
}

function typeClass({ size, shape }: Look): string {
  if (shape !== AVATAR_SHAPE.TILE) return SIZE_CLASS[size];
  const box = BOX_CLASS[size];
  return size === AVATAR_SIZE.CARD
    ? `${box} text-(length:--text-dialog)`
    : `${box} text-(length:--text-caption)`;
}

function groundClass({ glyph, tiled, branded, blank, hue }: Look): string {
  if (hue !== undefined) return `${HUE_CLASS[hue] ?? ""} text-on-identity`;
  if (glyph && branded) return "bg-avatar-tile text-avatar-ink";
  if (glyph && tiled)
    return "bg-ground bg-[linear-gradient(var(--color-secondary),var(--color-secondary))] text-inherit";
  if (glyph) return "bg-transparent text-inherit";
  if (blank) return "bg-transparent text-muted-foreground";
  return "bg-secondary text-muted-foreground";
}

function edgeClass({ shape, glyph, edged }: Look): string {
  if (glyph) return "after:content-none";
  if (shape !== AVATAR_SHAPE.TILE) return "after:shadow-avatar-edge";
  return edged ? "after:shadow-avatar-tile-edge" : "after:content-none";
}

function discClass(look: Look): string {
  return `ui-avatar ${typeClass(look)} ${SHAPE_CLASS[look.shape]} ${groundClass(look)} ${edgeClass(look)} leading-none`;
}

interface AvatarProps {
  name: string;
  id?: string;
  src?: string | undefined;
  size?: AvatarSize;
  shape?: AvatarShape;
  glyph?: ReactNode;
  tiled?: boolean;
  branded?: boolean;
  decorative?: boolean;
  edged?: boolean;
  blank?: boolean;
  lazy?: boolean;
  onFail?: () => void;
}

export const UNASSIGNED_WORDS = "Unassigned";

function standIn(glyph: ReactNode, letter: string): ReactNode {
  if (glyph !== undefined) return <span className={GLYPH_BOX}>{glyph}</span>;
  if (letter !== "") return <ReplayMask>{letter}</ReplayMask>;
  return (
    <span className={GLYPH_BOX}>
      <UserIcon />
    </span>
  );
}

function noChange(): () => void {
  return () => {};
}

function alreadyLoaded(img: HTMLImageElement | null): boolean {
  return img !== null && img.complete && img.naturalWidth > 0;
}

function AvatarDisc({
  name,
  id = name,
  src,
  size = AVATAR_SIZE.ROW,
  shape = AVATAR_SHAPE.CIRCLE,
  glyph,
  tiled = false,
  branded = false,
  decorative = false,
  edged = false,
  blank = false,
  lazy = false,
  onFail,
}: AvatarProps): React.JSX.Element {
  const [picture, setPicture] = useState<Picture>(PICTURE.LOADING);
  const url = picture === PICTURE.FAILED ? undefined : src;
  const shown = url !== undefined && picture === PICTURE.LOADED;
  const letter = identityLetter(name);
  const named =
    decorative || letter === "" ? { "aria-hidden": true } : { role: "img", "aria-label": name };
  const lettered = !shown && !blank && glyph === undefined && letter !== "";
  const client = useSyncExternalStore(
    noChange,
    () => true,
    () => false,
  );
  const hue = lettered ? identityHue(id) : undefined;
  const look = { size, shape, glyph: glyph !== undefined, tiled, branded, edged, blank, hue };
  return (
    <ShadcnAvatar
      className={discClass(look)}
      data-size={size}
      data-shape={shape}
      data-glyph={glyph === undefined ? undefined : "true"}
      data-edged={edged ? "true" : undefined}
      data-blank={blank ? "true" : undefined}
      data-tiled={glyph !== undefined && tiled ? "true" : undefined}
      data-branded={glyph !== undefined && branded ? "true" : undefined}
      data-hue={hue}
      {...named}
    >
      {shown || blank ? null : (
        <ShadcnAvatarFallback>{standIn(glyph, letter)}</ShadcnAvatarFallback>
      )}
      {url === undefined ? null : (
        <ShadcnAvatarImage
          keepMounted
          className="ui-avatar-picture data-[loaded=false]:invisible"
          src={url}
          alt=""
          referrerPolicy="no-referrer"
          loading={lazy ? "lazy" : undefined}
          draggable={false}
          data-loaded={client ? String(shown) : undefined}
          ref={(img) => {
            if (picture === PICTURE.LOADING && alreadyLoaded(img)) setPicture(PICTURE.LOADED);
          }}
          onLoad={() => setPicture(PICTURE.LOADED)}
          onError={() => {
            setPicture(PICTURE.FAILED);
            onFail?.();
          }}
        />
      )}
    </ShadcnAvatar>
  );
}

export function Avatar(props: AvatarProps): React.JSX.Element {
  return <AvatarDisc key={props.src ?? ""} {...props} />;
}

export function UnassignedAvatar({
  size = AVATAR_SIZE.ROW,
  decorative = false,
}: {
  size?: AvatarSize;
  decorative?: boolean;
}): React.JSX.Element {
  return (
    <ShadcnAvatar
      className={`ui-avatar ${SIZE_CLASS[size]} rounded-full bg-transparent text-muted-foreground after:content-none leading-none`}
      data-size={size}
      data-unassigned="true"
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": UNASSIGNED_WORDS })}
    >
      <svg
        className="ui-avatar-unassigned absolute inset-0 size-full"
        viewBox="0 0 16 16"
        aria-hidden="true"
      >
        <circle
          className="ui-avatar-unassigned-ring"
          cx="8"
          cy="8"
          r="7.3"
          pathLength="40"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeDasharray="3.2 1.8"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <g className="ui-avatar-unassigned-seat" fill="currentColor" opacity="0.62">
          <circle cx="8" cy="6.6" r="2.1" />
          <path d="M4.158 11.795A5.2 5.2 0 0 1 11.842 11.795A5.4 5.4 0 0 1 4.158 11.795Z" />
        </g>
      </svg>
    </ShadcnAvatar>
  );
}
