import { SavedTick, SettingsRow, Switch } from "@repo/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

function SavedSwitch(): React.JSX.Element {
  const [on, setOn] = useState(false);
  const [saves, setSaves] = useState(0);
  return (
    <SettingsRow
      label="Sound on send"
      adornment={<SavedTick saves={saves} />}
      description="Plays a short tone as a message leaves."
      labelsControl
    >
      {(control) => (
        <Switch
          id={control.controlId}
          label="Sound on send"
          checked={on}
          describedBy={control["aria-describedby"]}
          onChange={(next) => {
            setOn(next);
            setSaves((landed) => landed + 1);
          }}
        />
      )}
    </SettingsRow>
  );
}

function SavedTicks(): React.JSX.Element {
  return (
    <CatalogSection id="saved-tick-row" title="A setting written on change">
      <div className="catalog-column">
        <SavedSwitch />
      </div>
    </CatalogSection>
  );
}

export const SAVED_TICKS_EXAMPLE: Example = {
  id: "saved-ticks",
  title: "Saved tick",
  Render: SavedTicks,
};
