import { ALIGN, Checkbox, CodeCard, GAP, Stack } from "@repo/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

const copyToClipboard = (text: string): Promise<void> => navigator.clipboard.writeText(text);

function WithDetail(): React.JSX.Element {
  const [checked, setChecked] = useState(false);
  return (
    <Checkbox
      checked={checked}
      onChange={setChecked}
      detail={
        <CodeCard
          title="sh"
          code={"xcrun notarytool store-credentials vespin \\\n  --team-id ABCD1234"}
          copy={copyToClipboard}
        />
      }
    >
      On your Mac, store the notarization profile:
    </Checkbox>
  );
}

function Held({ start, children }: { start: boolean; children: string }): React.JSX.Element {
  const [checked, setChecked] = useState(start);
  return (
    <Checkbox checked={checked} onChange={setChecked}>
      {children}
    </Checkbox>
  );
}

function Wordless({ label }: { label: string }): React.JSX.Element {
  const [checked, setChecked] = useState(false);
  return <Checkbox label={label} checked={checked} onChange={setChecked} />;
}

function Checkboxes(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="checkbox-states" title="States">
        <Stack gap={GAP.CONTROL} align={ALIGN.START}>
          <Held start={false}>Include my name and email</Held>
          <Held start>Archive runs that succeed</Held>
          <Checkbox checked={false} mixed onChange={() => undefined}>
            Every server, some chosen
          </Checkbox>
          <Checkbox checked disabled onChange={() => undefined}>
            Unavailable while sending
          </Checkbox>
        </Stack>
      </CatalogSection>
      <CatalogSection id="checkbox-wordless" title="Without words, a task list's markers">
        <Stack gap={GAP.CONTROL} align={ALIGN.START}>
          <Wordless label="Send the invite" />
          <Checkbox label="Pick a date" checked disabled onChange={() => undefined} />
        </Stack>
      </CatalogSection>
      <CatalogSection id="checkbox-detail" title="A detail under its words, a to-do step's command">
        <div className="catalog-narrow">
          <WithDetail />
        </div>
      </CatalogSection>
      <CatalogSection id="checkbox-narrow" title="Narrow column, long words">
        <div className="catalog-narrow">
          <Held start>
            Send the transcript of this call, its description, and the screenshots attached to it
            with the report
          </Held>
        </div>
      </CatalogSection>
    </>
  );
}

export const CHECKBOXES_EXAMPLE: Example = {
  id: "checkboxes",
  title: "Checkboxes",
  Render: Checkboxes,
};
