import { GAP, Inline, Stack, Switch, SwitchMark, TEXT_TONE, Text } from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * switches.tsx -- a switch off, on, and unavailable in each, and the drawing
 * alone as a menu row draws it.
 */

function Held({ start, label }: { start: boolean; label: string }): React.JSX.Element {
  const [on, setOn] = useState(start);
  return <Switch checked={on} label={label} onChange={setOn} />;
}

function Switches(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="switch-states" title="Its own control">
        <Inline gap={GAP.FIELD}>
          <Held start={false} label="Off" />
          <Held start label="On" />
          <Switch checked={false} label="Off, unavailable" disabled onChange={() => undefined} />
          <Switch checked label="On, unavailable" disabled onChange={() => undefined} />
        </Inline>
      </CatalogSection>
      <CatalogSection id="switch-mark" title="Drawing alone, inside a row">
        <Stack gap={GAP.TIGHT}>
          {[true, false].map((on) => (
            <div key={String(on)} className="catalog-frame catalog-frame-wide">
              <Inline justify="between">
                <Text tone={TEXT_TONE.MUTED}>{on ? "Archive runs" : "Keep runs"}</Text>
                <SwitchMark checked={on} />
              </Inline>
            </div>
          ))}
        </Stack>
      </CatalogSection>
    </>
  );
}

export const SWITCHES_EXAMPLE: Example = { id: "switches", title: "Switches", Render: Switches };
