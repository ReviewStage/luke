import {
  GAP,
  LIST_ROW_CURRENT,
  List,
  ListRow,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * roving-keys.tsx -- a list Tab enters once, at the row last focused, whose rows ↑↓ walk, wrapping at the ends, Home and End going to the first and the last, the unavailable row stepped over.
 */

const PLACES = [
  { id: "inbox", name: "Inbox", note: "3 items" },
  { id: "tasks", name: "Tasks", note: "12 open" },
  { id: "archive", name: "Archive", note: "Syncing", disabled: true },
  { id: "channels", name: "Channels", note: "2 unread" },
  { id: "automations", name: "Automations", note: "4 on" },
] as const;

function Places(): React.JSX.Element {
  const [open, setOpen] = useState<string>("inbox");
  return (
    <Stack gap={GAP.TIGHT}>
      <List label="Places">
        {PLACES.map((place) => (
          <ListRow
            key={place.id}
            title={place.name}
            meta={place.note}
            disabled={"disabled" in place}
            current={open === place.id ? LIST_ROW_CURRENT.ITEM : undefined}
            onPress={() => setOpen(place.id)}
          />
        ))}
      </List>
      <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        Tab in once · ↑↓ walk the rows and wrap · Home and End · Archive is skipped
      </Text>
    </Stack>
  );
}

function RovingKeysExample(): React.JSX.Element {
  return (
    <CatalogSection id="roving-keys-list" title="A list walked with the arrows">
      <Places />
    </CatalogSection>
  );
}

export const ROVING_KEYS_EXAMPLE: Example = {
  id: "roving-keys",
  title: "Roving keys",
  Render: RovingKeysExample,
};
