import { type ReactNode, useState, useSyncExternalStore } from "react";
import { identityHue, identityLetter } from "../../actor-model.js";
import { UserIcon } from "../../face/glyphs.js";

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
  if (glyph !== undefined) return <span className="luke-avatar-glyph">{glyph}</span>;
  if (letter !== "") return letter;
  return (
    <span className="luke-avatar-glyph">
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
  return (
    <span
      className="luke-avatar"
      data-size={size}
      data-shape={shape}
      data-glyph={glyph === undefined ? undefined : "true"}
      data-edged={edged ? "true" : undefined}
      data-blank={blank ? "true" : undefined}
      data-tiled={glyph !== undefined && tiled ? "true" : undefined}
      data-hue={lettered ? identityHue(id) : undefined}
      {...named}
    >
      {shown || blank ? null : standIn(glyph, letter)}
      {url === undefined ? null : (
        <img
          className="luke-avatar-picture"
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
    </span>
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
    <span
      className="luke-avatar"
      data-size={size}
      data-unassigned="true"
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": UNASSIGNED_WORDS })}
    >
      <svg className="luke-avatar-unassigned" viewBox="0 0 16 16" aria-hidden="true">
        <circle className="luke-avatar-unassigned-ring" cx="8" cy="8" r="7.3" pathLength="40" />
        {/* The shoulders are the arc of a circle beneath, closed by the bottom of the seat's own 5.4 circle inside the ring, where the two cross. */}
        <g className="luke-avatar-unassigned-seat">
          <circle cx="8" cy="6.6" r="2.1" />
          <path d="M4.158 11.795A5.2 5.2 0 0 1 11.842 11.795A5.4 5.4 0 0 1 4.158 11.795Z" />
        </g>
      </svg>
    </span>
  );
}
