import { type ReactNode, useState, useSyncExternalStore } from "react";
import { identityHue, identityLetter } from "../../actor-model.js";
import { UserIcon } from "../../face/glyphs.js";
import {
  Avatar as ShadcnAvatar,
  AvatarFallback as ShadcnAvatarFallback,
  AvatarImage as ShadcnAvatarImage,
} from "../../shadcn/avatar.js";

/**
 * avatar.tsx -- a person drawn as a disc, or an app as a square: their picture, their letter on a hue, a glyph, or a quiet figure.
 *
 * The disc is one box per size whatever stands in it, so a row, a byline,
 * and a page's head keep their alignment as a picture loads, fails, or was
 * never there. The letter stands from the first frame on the hue read off
 * `id`, and stays until the picture has loaded, so a picture on the network
 * never leaves an empty disc, and a picture that fails leaves the letter
 * where it was. A name with no character to draw stands as the figure on a
 * quiet tile. The disc names its person to a reader, unless the name already
 * stands beside it, where it is `decorative` and said once, or is blank.
 *
 * An app, a bot, or an agent stands in a square (`AVATAR_SHAPE.SQUARE`)
 * whose corner grows with its size, by its picture or, in place of a
 * letter, its `glyph`: the glyph alone on the ground beneath it, in the ink
 * around it, or on a quiet tile where it is `tiled`, as a facepile whose
 * faces overlap draws it so the face beneath never shows through.
 *
 * Nobody, where a place says who is on something and no one is, stands as
 * an empty seat in a dashed outline of the same box (`UnassignedAvatar`),
 * as Linear draws a task with no assignee: a solid head and shoulders cut
 * off by the ring, so the row reads level with its neighbours, never passes
 * for anyone's face, and the figure, solid rather than traced so it holds at
 * a row's smallest size, tells it from the backlog's dashed status ring.
 *
 * It is drawn by shadcn/ui's Base UI avatar (`../../shadcn/avatar.tsx`) in
 * Tailwind utilities over the theme, each disc's size, corner, ground, ink,
 * and edge picked here, so no rule weighs one against another. Note that
 * the picture is Base UI's image held mounted (`keepMounted`) rather than
 * its default, because the default asks for the picture through an image of
 * its own off the page and mounts the element only once that has loaded:
 * a lazy picture would be fetched at once, a server-rendered page would
 * show no picture without scripts, and the element a caller's test and the
 * browser answer would not be there while it loads. So the picture stands
 * in the page from the first frame, hidden until loaded, and how it has
 * fared is still read off its own load and error and the ref's look at a
 * picture drawn before the page took over, as before: Base UI's own reading
 * would call a cached picture with no intrinsic width failed. The stand-in
 * is Base UI's fallback, drawn while the disc says no picture is shown.
 */

/** How large the disc is drawn: a mark at a row's time, in a line of words, at a control's glyph size, in a facepile, a list row's, the account's, a card head's, a page's head, a detail page's masthead, or a portrait beside a biography. */
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

/** The outline: a person's circle, an app's, a bot's, or an agent's square, or a workspace's or repository's tile, whose corner is a quarter of its edge. */
export const AVATAR_SHAPE = {
  CIRCLE: "circle",
  SQUARE: "square",
  TILE: "tile",
} as const;

export type AvatarShape = (typeof AVATAR_SHAPE)[keyof typeof AVATAR_SHAPE];

/** How far a picture has got: still on its way, drawn, or given up. */
const PICTURE = {
  LOADING: "loading",
  LOADED: "loaded",
  FAILED: "failed",
} as const;

type Picture = (typeof PICTURE)[keyof typeof PICTURE];

/** Each size's box, and its letter at half the box. */
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

/** Each size's box alone, for no one's outline, which holds no letter. */
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

/**
 * Each outline's corner, which its edge (`::after`) wears too: a circle's; a square's, a share of its edge, so it
 * reads as one shape at every size, rounder than a tile of its size; a
 * tile's, a quarter of its edge.
 */
const SHAPE_CLASS: Record<AvatarShape, string> = {
  [AVATAR_SHAPE.CIRCLE]: "rounded-full after:rounded-full",
  [AVATAR_SHAPE.SQUARE]: "rounded-avatar-square after:rounded-avatar-square",
  [AVATAR_SHAPE.TILE]: "rounded-avatar-tile after:rounded-avatar-tile",
};

/** The six identity hues a letter stands on, by the hue `identityHue` reads off an id. */
const HUE_CLASS: Readonly<Record<number, string>> = {
  1: "bg-identity-1",
  2: "bg-identity-2",
  3: "bg-identity-3",
  4: "bg-identity-4",
  5: "bg-identity-5",
  6: "bg-identity-6",
};

/** The box a glyph stands in: the disc's whole, its glyph a share of it at every size. */
const GLYPH_BOX = "luke-avatar-glyph grid size-full place-items-center *:size-avatar-glyph-share";

/** What a disc is drawn as, read off its props and how its picture has fared. */
interface Look {
  readonly size: AvatarSize;
  readonly shape: AvatarShape;
  readonly glyph: boolean;
  readonly tiled: boolean;
  readonly edged: boolean;
  readonly blank: boolean;
  readonly hue: number | undefined;
}

/** A disc's letter size: a share of its box, or a tile's caption, a card head's tile a dialog's, so the small tiles keep a readable letter. */
function typeClass({ size, shape }: Look): string {
  if (shape !== AVATAR_SHAPE.TILE) return SIZE_CLASS[size];
  const box = BOX_CLASS[size];
  return size === AVATAR_SIZE.CARD
    ? `${box} text-(length:--text-dialog)`
    : `${box} text-(length:--text-caption)`;
}

/**
 * A disc's ground and ink: a letter's identity hue; an app's glyph tiled on
 * the quiet fill laid over the ground, so it is opaque and a face it
 * overlaps never shows through; an app's glyph bare, in the ink around it;
 * a blank tile's nothing until its picture has loaded; or the quiet fill.
 */
function groundClass({ glyph, tiled, blank, hue }: Look): string {
  if (hue !== undefined) return `${HUE_CLASS[hue] ?? ""} text-on-identity`;
  if (glyph && tiled)
    return "bg-ground bg-[linear-gradient(var(--color-secondary),var(--color-secondary))] text-inherit";
  if (glyph) return "bg-transparent text-inherit";
  if (blank) return "bg-transparent text-muted-foreground";
  return "bg-secondary text-muted-foreground";
}

/** A disc's edge: a hairline, so a picture keeps its edge on a ground of its own colour; a tile's, only where it is `edged`; none round an app's glyph. */
function edgeClass({ shape, glyph, edged }: Look): string {
  if (glyph) return "after:content-none";
  if (shape !== AVATAR_SHAPE.TILE) return "after:shadow-avatar-edge";
  return edged ? "after:shadow-avatar-tile-edge" : "after:content-none";
}

/** Every class a disc wears, its line closing them so a letter of any size sits at the box's centre. */
function discClass(look: Look): string {
  return `luke-avatar ${typeClass(look)} ${SHAPE_CLASS[look.shape]} ${groundClass(look)} ${edgeClass(look)} leading-none`;
}

interface AvatarProps {
  name: string;
  /** What the hue is read off, so a rename keeps the colour a person is known by. */
  id?: string;
  /** The picture's address, which a caller sizes for the disc. */
  src?: string | undefined;
  size?: AvatarSize;
  shape?: AvatarShape;
  /** What stands in place of the letter until a picture is shown: an app's, a bot's, or an agent's glyph. */
  glyph?: ReactNode;
  /** Whether the glyph stands on a quiet tile rather than bare. */
  tiled?: boolean;
  /** Whether the name already stands beside the disc, so a reader hears it once. */
  decorative?: boolean;
  /** Whether a tile wears a hairline edge, so a picture drawn on white does not bleed into the ground around it. */
  edged?: boolean;
  /** Whether nothing stands on the ground until the picture has loaded, neither letter nor figure, so the caller's own fallback can take its place where the picture fails. */
  blank?: boolean;
  /** Whether the browser may hold the picture back until it nears the screen, as a long list's rows do. */
  lazy?: boolean;
  /** Called once when the picture fails to load. */
  onFail?: () => void;
}

/** What the dashed outline is called, to a reader and in its hint. */
export const UNASSIGNED_WORDS = "Unassigned";

/** What stands on the disc while no picture is shown: the caller's glyph, the letter, or the figure where there is no letter. */
function standIn(glyph: ReactNode, letter: string): ReactNode {
  if (glyph !== undefined) return <span className={GLYPH_BOX}>{glyph}</span>;
  if (letter !== "") return letter;
  return (
    <span className={GLYPH_BOX}>
      <UserIcon />
    </span>
  );
}

/** Nothing to listen to: whether the page has been taken over never changes once it has. */
function noChange(): () => void {
  return () => {};
}

/** A picture the browser had already drawn before the page took it over, as a server-rendered page's may, which sends no load event of its own. */
function alreadyLoaded(img: HTMLImageElement | null): boolean {
  return img !== null && img.complete && img.naturalWidth > 0;
}

/** The disc for one picture address, which forgets how its picture fared when the address changes. */
function AvatarDisc({
  name,
  id = name,
  src,
  size = AVATAR_SIZE.ROW,
  shape = AVATAR_SHAPE.CIRCLE,
  glyph,
  tiled = false,
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
  // A blank name has nothing to say to a reader, so its figure is hidden as a decorative disc is.
  const named =
    decorative || letter === "" ? { "aria-hidden": true } : { role: "img", "aria-label": name };
  const lettered = !shown && !blank && glyph === undefined && letter !== "";
  // Note that a server-rendered picture is not hidden until the page takes it over, because a page read without scripts must still show it.
  const client = useSyncExternalStore(
    noChange,
    () => true,
    () => false,
  );
  const hue = lettered ? identityHue(id) : undefined;
  const look = { size, shape, glyph: glyph !== undefined, tiled, edged, blank, hue };
  return (
    <ShadcnAvatar
      className={discClass(look)}
      data-size={size}
      data-shape={shape}
      data-glyph={glyph === undefined ? undefined : "true"}
      data-edged={edged ? "true" : undefined}
      data-blank={blank ? "true" : undefined}
      data-tiled={glyph !== undefined && tiled ? "true" : undefined}
      data-hue={hue}
      {...named}
    >
      {shown || blank ? null : (
        <ShadcnAvatarFallback>{standIn(glyph, letter)}</ShadcnAvatarFallback>
      )}
      {url === undefined ? null : (
        <ShadcnAvatarImage
          keepMounted
          className="luke-avatar-picture data-[loaded=false]:invisible"
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

/** The person or app `name`, by the picture at `src` once it loads, and by `glyph`, or their letter on the hue of `id`, until then. */
export function Avatar(props: AvatarProps): React.JSX.Element {
  // Note that the disc is keyed by its address, because a picture that failed must be asked for again once a caller gives its address back, and only a fresh disc forgets the failure.
  return <AvatarDisc key={props.src ?? ""} {...props} />;
}

/** No one, an empty seat in a dashed outline of the disc's box at `size`, named Unassigned to a reader unless the words already stand beside it. */
export function UnassignedAvatar({
  size = AVATAR_SIZE.ROW,
  decorative = false,
}: {
  size?: AvatarSize;
  /** Whether "Unassigned" already stands beside the outline, so a reader hears it once. */
  decorative?: boolean;
}): React.JSX.Element {
  return (
    <ShadcnAvatar
      className={`luke-avatar ${SIZE_CLASS[size]} rounded-full bg-transparent text-muted-foreground after:content-none leading-none`}
      data-size={size}
      data-unassigned="true"
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": UNASSIGNED_WORDS })}
    >
      <svg
        className="luke-avatar-unassigned absolute inset-0 size-full"
        viewBox="0 0 16 16"
        aria-hidden="true"
      >
        {/* Note that the ring is held a hairline on its circle itself, because `vector-effect` is not inherited from the outline around it; its eight long dashes are laid evenly round it (`pathLength`) with round ends, so it is never read as the backlog's shorter-dashed status ring. */}
        <circle
          className="luke-avatar-unassigned-ring"
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
        {/* The seat is filled rather than traced, so it holds at a row's smallest size, and fainter than the ring, so the outline leads. The shoulders are the arc of a circle beneath, closed by the bottom of the seat's own 5.4 circle inside the ring, where the two cross. */}
        <g className="luke-avatar-unassigned-seat" fill="currentColor" opacity="0.62">
          <circle cx="8" cy="6.6" r="2.1" />
          <path d="M4.158 11.795A5.2 5.2 0 0 1 11.842 11.795A5.4 5.4 0 0 1 4.158 11.795Z" />
        </g>
      </svg>
    </ShadcnAvatar>
  );
}
