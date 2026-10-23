import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";

/**
 * picture-tile.tsx -- a picture that opens when pressed: the press that enlarges a picture over the window, around the picture as its place draws it.
 *
 * A tile is a `<button>` with no box of its own, so what is seen is the
 * picture the place hands it (`children`), in that place's own frame, and
 * the press is the whole of it. It is named for what a press does,
 * "Enlarge" and the picture's words after it (`name`), and wears the
 * zooming pointer. A press sinks the picture a little under the finger and
 * lets it spring back, by transform alone, so nothing beside it moves; the
 * tile stays put while its face moves, so a press made near its edge still
 * lands on it. The keyboard's ring is drawn around the picture
 * (`data-focus-ring`) rather than around a caption under it.
 *
 * It hugs its picture, at most its container's width, unless it fills the
 * room its container gives it (`fill`), as a set's tile does. Words under
 * the picture that a press takes with it (`caption`) stand inside the
 * press, under the face, and do not sink with it. What a press does is the
 * place's (`onOpen`), handed the click so it can keep the press from the
 * element around it, or let it through; an app's hint wraps it as it wraps
 * a Button, handing it the pointer, press, and focus handlers it shows and
 * goes on by, each heard before the tile's own. A place whose pointer's
 * press opens nothing, and falls through to what is around the tile, says
 * so (`pointerOpens`): the tile then wears the plain pointer and does not
 * sink, while a key's press still opens it.
 */

/** What a press is named for, the picture's words after it. */
const ENLARGE_LABEL = "Enlarge";

/** What an app's hint hands the tile it wraps: when to show and go, and the chord it names. */
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

/** A picture that opens when pressed, named "Enlarge" and its words. */
export function PictureTile({
  name,
  onOpen,
  fill = false,
  pointerOpens = true,
  caption,
  children,
  onClick,
  ...hinted
}: HintProps & {
  /** The picture's words, its alt text or caption; empty where it has none, and the tile is named "Enlarge" alone. */
  name: string;
  /** Opens the picture, handed the press. */
  onOpen: (event: MouseEvent<HTMLButtonElement>) => void;
  /** Whether it fills the room its container gives it rather than hugging its picture. */
  fill?: boolean | undefined;
  /** Whether a pointer's press opens it, so it wears the zooming pointer and sinks; a key's press always does. */
  pointerOpens?: boolean | undefined;
  /** Words under the picture that the press takes with it. */
  caption?: ReactNode;
  /** The picture, in its place's own frame. */
  children: ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="luke-picture-tile"
      data-fill={fill}
      data-pointer-opens={pointerOpens}
      aria-label={name === "" ? ENLARGE_LABEL : `${ENLARGE_LABEL} ${name}`}
      {...hinted}
      onClick={(event) => {
        onClick?.(event);
        onOpen(event);
      }}
    >
      <span className="luke-picture-tile-face" data-focus-ring="">
        {children}
      </span>
      {caption}
    </button>
  );
}
