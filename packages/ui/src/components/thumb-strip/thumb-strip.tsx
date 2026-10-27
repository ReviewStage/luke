import { type ReactNode, useEffect, useRef } from "react";
import { PAGE_THUMB_SIZE, PageThumb } from "../page-thumb/page-thumb.js";

/**
 * thumb-strip.tsx -- a row of small previews of the files a viewer walks through, the one shown marked, a press on another showing it.
 *
 * Each file stands as a row's `PageThumb`: its picture where it is one, or
 * the glyph its place hands for any other file. The one shown stands at
 * full strength in a ring of the text's ink; the rest are dimmed until the
 * pointer is on them. The strip is centred in its room and scrolls across
 * where its files outrun it, keeping the one shown in sight as the walk
 * moves.
 *
 * The strip is one stop of the tab order, the shown file's thumb, so a
 * walk of many files costs Tab one press; the arrow keys walk the files
 * through the viewer that holds it, and where the focus stood on the strip
 * it follows the file shown. Each thumb is named for its file and says
 * which one is shown (`aria-current`). Its pictures are left out of the
 * screen recording, since a picture can hold words and the recording
 * carries none.
 *
 * It is drawn in Tailwind utilities over the theme, with no shadcn/ui base:
 * shadcn has no strip of previews, and each press is a bare button around
 * its thumb, which draws the box.
 */

/** One file of the strip: its name, and its picture or the glyph that stands for it. */
export interface ThumbStripItem {
  /** The file's name, which its press is named for. */
  readonly name: string;
  /** The picture's address, where the file is one. */
  readonly image?: string | undefined;
  /** What stands for a file with no picture, such as its type's glyph. */
  readonly glyph?: ReactNode;
}

/**
 * A thumb's press: no box of its own, so the thumb draws the box and the ring
 * takes its corners; dimmed while another is shown and lit under the
 * pointer, the shown one ringed.
 */
const THUMB =
  "luke-thumb-strip-thumb flex-none cursor-press rounded-control border-0 bg-transparent p-0 opacity-60 transition-opacity duration-(--luke-duration-hover) ease-motion-exit hover:opacity-100 aria-[current=true]:opacity-100 aria-[current=true]:[&>.luke-page-thumb]:outline-2 aria-[current=true]:[&>.luke-page-thumb]:outline-offset-1 aria-[current=true]:[&>.luke-page-thumb]:outline-foreground aria-[current=true]:[&>.luke-page-thumb]:outline-solid";

/** A strip of the files `items`, the one at `at` shown, `onPick` showing another. */
export function ThumbStrip({
  label,
  items,
  at,
  onPick,
}: {
  /** What the list of thumbs is named. */
  label: string;
  items: readonly ThumbStripItem[];
  /** Which of `items` is shown. */
  at: number;
  /** Shows the file at this place. */
  onPick: (at: number) => void;
}): React.JSX.Element {
  const list = useRef<HTMLUListElement>(null);
  // The shown thumb stays in sight as the walk moves, and takes the focus where it stood on the strip.
  useEffect(() => {
    const box = list.current;
    const shown = box?.querySelector<HTMLButtonElement>('[aria-current="true"]');
    if (box === null || shown === null || shown === undefined) return;
    // Note that the strip scrolls itself rather than calling `scrollIntoView`, because that scrolls every box around it, the card that clips it among them.
    const room = box.getBoundingClientRect();
    const thumb = shown.getBoundingClientRect();
    if (thumb.left < room.left) box.scrollLeft -= room.left - thumb.left;
    else if (thumb.right > room.right) box.scrollLeft += thumb.right - room.right;
    if (box.contains(document.activeElement)) shown.focus({ preventScroll: true });
  }, [at]);
  return (
    <ul
      ref={list}
      className="luke-thumb-strip ph-no-capture m-0 flex max-w-full list-none gap-luke-8 overflow-x-auto p-luke-4 [scrollbar-width:none]"
      aria-label={label}
    >
      {items.map((item, index) => (
        // Note that a thumb is keyed by its place, because two files may hold the same picture under the same name.
        <li key={index} className="flex flex-none">
          <button
            type="button"
            className={THUMB}
            aria-label={item.name}
            aria-current={index === at}
            tabIndex={index === at ? 0 : -1}
            onClick={() => onPick(index)}
          >
            <PageThumb size={PAGE_THUMB_SIZE.ROW} image={item.image} glyph={item.glyph} />
          </button>
        </li>
      ))}
    </ul>
  );
}
