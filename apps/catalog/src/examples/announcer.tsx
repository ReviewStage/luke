import { ANNOUNCE, announce, Button, GAP, Inline, Stack, TEXT_TONE, Text } from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * announcer.tsx -- the window's one pair of live regions, which the catalog's
 * root mounts as an app's does: words said politely, the same words said
 * again and read again, a burst that ends on its last words, and an alert
 * that interrupts. The regions are drawn nowhere; a screen reader, or the
 * accessibility tree, hears them.
 */

function Announcers(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="announcer-polite" title="Said politely, and said again">
        <Stack gap={GAP.CONTROL}>
          <Text tone={TEXT_TONE.MUTED}>
            Each press says Task archived, read once the reader is free; a second press reads it
            again.
          </Text>
          <Inline gap={GAP.CONTROL}>
            <Button onClick={() => announce(ANNOUNCE.POLITE, "Task archived")}>
              Say Task archived
            </Button>
            <Button
              onClick={() => {
                announce(ANNOUNCE.POLITE, "Task moved");
                announce(ANNOUNCE.POLITE, "Task renamed");
                announce(ANNOUNCE.POLITE, "3 tasks done");
              }}
            >
              Say a burst
            </Button>
          </Inline>
        </Stack>
      </CatalogSection>
      <CatalogSection id="announcer-alert" title="An alert, which interrupts">
        <Button onClick={() => announce(ANNOUNCE.ALERT, "Couldn't save the setting")}>
          Say a refusal
        </Button>
      </CatalogSection>
    </>
  );
}

export const ANNOUNCER_EXAMPLE: Example = {
  id: "announcer",
  title: "Announcer",
  Render: Announcers,
};
