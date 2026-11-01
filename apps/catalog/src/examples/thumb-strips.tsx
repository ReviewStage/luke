import { CheckIcon, ThumbStrip } from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";
import { useStandIn } from "./video-player";

/**
 * thumb-strips.tsx -- the strip of previews along a viewer's foot: a
 * message's pictures, a recording by its first frame once the page has
 * recorded its stand-in (`video-player.tsx`), and a file with none, the one
 * shown ringed, a press on another showing it.
 */

/** A picture of one colour, told apart from its neighbours by it. */
const picture = (fill: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="100%" height="100%" fill="${fill}"/><rect x="12" y="12" width="70" height="10" rx="4" fill="#fff9"/></svg>`,
  )}`;

const ITEMS = [
  { name: "inbox.png", image: picture("#7aa7f4") },
  { name: "thread.png", image: picture("#f4a77a") },
  { name: "review.png", image: picture("#7af4b5") },
  { name: "notes.txt", glyph: <CheckIcon /> },
  { name: "settings.png", image: picture("#c87af4") },
];

function ThumbStrips(): React.JSX.Element {
  const [at, setAt] = useState(1);
  const standIn = useStandIn();
  const items =
    typeof standIn === "string"
      ? ITEMS
      : [...ITEMS, { name: "recording.webm", video: standIn.url }];
  return (
    <CatalogSection id="thumb-strip" title="A viewer's files">
      <ThumbStrip label="Files" items={items} at={at} onPick={setAt} />
    </CatalogSection>
  );
}

export const THUMB_STRIPS_EXAMPLE: Example = {
  id: "thumb-strips",
  title: "Thumb strips",
  Render: ThumbStrips,
};
