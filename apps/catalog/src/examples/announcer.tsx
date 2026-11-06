import {
  ANNOUNCE,
  Announcer,
  announce,
  Button,
  GAP,
  Inline,
  Stack,
  TEXT_TONE,
  Text,
} from "@repo/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

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
        <Announcer />
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
