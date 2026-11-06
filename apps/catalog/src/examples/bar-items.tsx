import {
  BarAction,
  BarItem,
  BarItems,
  EllipsisIcon,
  FolderIcon,
  GearIcon,
  PlusIcon,
  SearchIcon,
} from "@repo/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

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

function FloatingBar(): React.JSX.Element {
  const [place, setPlace] = useState<Place>(PLACE.INBOX);
  const [asked, setAsked] = useState(0);
  return (
    <nav aria-label="Places" style={{ display: "flex", gap: 12, maxWidth: 360, padding: 12 }}>
      <BarItems>
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
          onPress={() => setPlace(PLACE.TASKS)}
        >
          Tasks
        </BarItem>
        <BarItem icon={<SearchIcon />} onPress={() => setAsked(asked + 1)}>
          Search
        </BarItem>
      </BarItems>
      <BarAction icon={<PlusIcon />} label="New task" onPress={() => setAsked(asked + 1)} />
    </nav>
  );
}

function BarItemsExample(): React.JSX.Element {
  return (
    <>
      <CatalogSection
        id="bar-item-places"
        title="Places in a bar, one shown, two counting what waits, More opening a drawer"
      >
        <Bar />
      </CatalogSection>
      <CatalogSection
        id="bar-item-floating"
        title="A phone's floating bar: places in one pill, the one shown on the selection's fill, beside a round action"
      >
        <FloatingBar />
      </CatalogSection>
    </>
  );
}

export const BAR_ITEMS_EXAMPLE: Example = {
  id: "bar-items",
  title: "Bar items",
  Render: BarItemsExample,
};
