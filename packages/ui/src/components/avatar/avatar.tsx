import { useState } from "react";
import { identityHue, identityLetter } from "../../actor-model.js";
import { UserIcon } from "../../face/glyphs.js";

/**
 * avatar.tsx -- a person drawn as a disc: their picture, their letter on a hue, or a quiet figure.
 *
 * The disc is one box per size whatever stands in it, so a row, a byline,
 * and a page's head keep their alignment as a picture loads, fails, or was
 * never there. The letter stands from the first frame on the hue read off
 * `id`, and stays until the picture has loaded, so a picture on the network
 * never leaves an empty disc, and a picture that fails leaves the letter
 * where it was. A name with no character to draw stands as the figure on a
 * quiet tile. The disc names its person to a reader, unless the name already
 * stands beside it, where it is `decorative` and said once, or is blank.
 */

/** How large the disc is drawn: a mark at a row's time, in a line of words, in a facepile, a list row's, the account's, a card head's, or a page's head. */
export const AVATAR_SIZE = {
  MARK: "mark",
  INLINE: "inline",
  STACK: "stack",
  ROW: "row",
  ACCOUNT: "account",
  CARD: "card",
  PAGE: "page",
} as const;

export type AvatarSize = (typeof AVATAR_SIZE)[keyof typeof AVATAR_SIZE];

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
  src?: string;
  size?: AvatarSize;
  /** Whether the name already stands beside the disc, so a reader hears it once. */
  decorative?: boolean;
}

/** The disc for one picture address, which forgets how its picture fared when the address changes. */
function AvatarDisc({
  name,
  id = name,
  src,
  size = AVATAR_SIZE.ROW,
  decorative = false,
}: AvatarProps): React.JSX.Element {
  const [picture, setPicture] = useState<Picture>(PICTURE.LOADING);
  const url = picture === PICTURE.FAILED ? undefined : src;
  const shown = url !== undefined && picture === PICTURE.LOADED;
  const letter = identityLetter(name);
  // A blank name has nothing to say to a reader, so its figure is hidden as a decorative disc is.
  const named =
    decorative || letter === "" ? { "aria-hidden": true } : { role: "img", "aria-label": name };
  return (
    <span
      className="luke-avatar"
      data-size={size}
      data-hue={shown || letter === "" ? undefined : identityHue(id)}
      {...named}
    >
      {shown ? null : letter === "" ? <UserIcon /> : letter}
      {url === undefined ? null : (
        <img
          className="luke-avatar-picture"
          src={url}
          alt=""
          referrerPolicy="no-referrer"
          draggable={false}
          data-loaded={String(shown)}
          onLoad={() => setPicture(PICTURE.LOADED)}
          onError={() => setPicture(PICTURE.FAILED)}
        />
      )}
    </span>
  );
}

/** The person `name`, by the picture at `src` once it loads, and by their letter on the hue of `id` until then. */
export function Avatar(props: AvatarProps): React.JSX.Element {
  // Note that the disc is keyed by its address, because a picture that failed must be asked for again once a caller gives its address back, and only a fresh disc forgets the failure.
  return <AvatarDisc key={props.src ?? ""} {...props} />;
}
