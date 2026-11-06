import { type ReactNode, useEffect, useRef } from "react";
import { PAGE_THUMB_SIZE, PageThumb } from "../page-thumb/page-thumb.js";

export interface ThumbStripItem {
  readonly name: string;
  readonly image?: string | undefined;
  readonly video?: string | undefined;
  readonly glyph?: ReactNode;
}

const THUMB =
  "ui-thumb-strip-thumb flex flex-none cursor-press rounded-control border-0 bg-popover p-0 brightness-60 transition-[filter] duration-(--ui-duration-hover) ease-motion-exit hover:brightness-100 aria-[current=true]:brightness-100 aria-[current=true]:[&>.ui-page-thumb]:outline-2 aria-[current=true]:[&>.ui-page-thumb]:outline-offset-1 aria-[current=true]:[&>.ui-page-thumb]:outline-foreground aria-[current=true]:[&>.ui-page-thumb]:outline-solid";

export function ThumbStrip({
  label,
  items,
  at,
  onPick,
}: {
  label: string;
  items: readonly ThumbStripItem[];
  at: number;
  onPick: (at: number) => void;
}): React.JSX.Element {
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const box = list.current;
    const shown = box?.querySelector<HTMLButtonElement>('[aria-current="true"]');
    if (box === null || shown === null || shown === undefined) return;
    const room = box.getBoundingClientRect();
    const thumb = shown.getBoundingClientRect();
    if (thumb.left < room.left) box.scrollLeft -= room.left - thumb.left;
    else if (thumb.right > room.right) box.scrollLeft += thumb.right - room.right;
    if (box.contains(document.activeElement)) shown.focus({ preventScroll: true });
  }, [at]);
  return (
    <ul
      ref={list}
      className="ui-thumb-strip ph-no-capture m-0 flex max-w-full list-none gap-ui-8 overflow-x-auto p-ui-4 [scrollbar-width:none]"
      aria-label={label}
    >
      {items.map((item, index) => (
        <li key={index} className="flex flex-none">
          <button
            type="button"
            className={THUMB}
            aria-label={item.name}
            aria-current={index === at}
            tabIndex={index === at ? 0 : -1}
            onClick={() => onPick(index)}
          >
            <PageThumb
              size={PAGE_THUMB_SIZE.ROW}
              image={item.image}
              video={item.video}
              glyph={item.glyph}
            />
          </button>
        </li>
      ))}
    </ul>
  );
}
