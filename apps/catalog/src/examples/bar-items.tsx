import { BarItem, EllipsisIcon, FolderIcon, GearIcon } from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * bar-items.tsx -- a phone's bar of places: glyphs over names, the place
 * shown in the accent's ink, counts of what waits on the reader on their
 * glyphs, short and long, and a last item that opens a drawer and says
 * whether it stands open.
 */

const PLACE = { INBOX: "inbox", TASKS: "tasks" } as const;
type Place = (typeof PLACE)[keyof typeof PLACE];

function Bar(): React.JSX.Element {
  const [place, setPlace] = useState<Place>(PLACE.INBOX);
  const [open, setOpen] = useState(false);
  return (
    <nav aria-label="Places" style={{ display: "flex", maxWidth: 360 }}>
      <BarItem
        icon={<FolderIcon />}
        current={place === PLACE.INBOX}
        count={{ value: 3, noun: "need you" }}
        onPress={() => setPlace(PLACE.INBOX)}
      >
        Inbox
      </BarItem>
      <BarItem
        icon={<GearIcon />}
        current={place === PLACE.TASKS}
        count={{ value: 128, noun: "need you" }}
        onPress={() => setPlace(PLACE.TASKS)}
      >
        Tasks
      </BarItem>
      <BarItem icon={<EllipsisIcon />} expanded={open} onPress={() => setOpen(!open)}>
        More
      </BarItem>
    </nav>
  );
}

function BarItems(): React.JSX.Element {
  return (
    <CatalogSection
      id="bar-item-places"
      title="Places in a bar, one shown, two counting what waits, More opening a drawer"
    >
      <Bar />
    </CatalogSection>
  );
}

export const BAR_ITEMS_EXAMPLE: Example = {
  id: "bar-items",
  title: "Bar items",
  Render: BarItems,
};
