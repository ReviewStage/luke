/**
 * drawer-swipes.tsx -- a phone's drawer on a stage a phone's size: a finger swiped in from its left edge drags the drawer and the dimmed window under it as one, and it springs open past half way or shut short of it; swiped left it shuts. A mouse keeps the button alone.
 */

import {
  BUTTON_VARIANT,
  Button,
  DrawerScrim,
  GAP,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  useDrawerSwipe,
} from "@luke/ui";
import { useRef, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

function DrawerSwipes(): React.JSX.Element {
  const stage = useRef<HTMLDivElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  useDrawerSwipe({
    enabled: true,
    open,
    stage,
    drawer: () => drawer.current,
    onOpen: () => setOpen(true),
    onClose: () => setOpen(false),
  });
  return (
    <CatalogSection id="drawer-swipe" title="Swiped in from the edge">
      <Stack gap={GAP.FIELD}>
        <div ref={stage} className="catalog-drawer-stage" data-open={String(open)}>
          <aside ref={drawer} className="catalog-drawer" inert={!open} aria-label="Drawer">
            <Stack gap={GAP.TIGHT}>
              <Text variant={TEXT_VARIANT.LABEL}>Drawer</Text>
              <Button variant={BUTTON_VARIANT.QUIET} onClick={() => setOpen(false)}>
                Close
              </Button>
            </Stack>
          </aside>
          <DrawerScrim open={open} />
          <div className="catalog-drawer-work" inert={open}>
            <Text variant={TEXT_VARIANT.BODY}>
              The work. Swipe in from a little way inside the left edge.
            </Text>
          </div>
        </div>
        <Button variant={BUTTON_VARIANT.OUTLINE} onClick={() => setOpen((was) => !was)}>
          {open ? "Shut the drawer" : "Open the drawer"}
        </Button>
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          Under a finger alone: the first 20px of the edge stay the browser's back swipe.
        </Text>
      </Stack>
    </CatalogSection>
  );
}

export const DRAWER_SWIPES_EXAMPLE: Example = {
  id: "drawer-swipes",
  title: "Drawer swipes",
  Render: DrawerSwipes,
};
