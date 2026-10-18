import {
  ALIGN,
  GAP,
  Inline,
  MARK_PROVIDER,
  ProviderMark,
  SELECT_ALIGN,
  SELECT_WIDTH,
  Select,
  type SelectAlign,
  type SelectOption,
  type SelectWidth,
  Stack,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * select.tsx -- a select naming its value, with a value that cannot be
 * chosen now, with a glyph on each value, unavailable, hung from its
 * trailing edge, in the field column a settings row's pop-ups share, and
 * with a long value in a narrow column.
 */

const THEMES: readonly SelectOption<string>[] = [
  { value: "system", label: "Match system" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "sepia", label: "Sepia", disabled: true },
];

const PROVIDERS: readonly SelectOption<string>[] = [
  { value: "github", label: "GitHub", icon: <ProviderMark provider={MARK_PROVIDER.GITHUB} /> },
  { value: "linear", label: "Linear", icon: <ProviderMark provider={MARK_PROVIDER.LINEAR} /> },
];

const VOICES: readonly SelectOption<string>[] = [
  { value: "short", label: "Ember" },
  { value: "long", label: "A voice whose name runs well past the column it stands in" },
];

function Held({
  label,
  options,
  start,
  disabled = false,
  align = SELECT_ALIGN.START,
  width = SELECT_WIDTH.FIT,
}: {
  label: string;
  options: readonly SelectOption<string>[];
  start: string;
  disabled?: boolean;
  align?: SelectAlign;
  width?: SelectWidth;
}): React.JSX.Element {
  const [value, setValue] = useState(start);
  return (
    <Select
      label={label}
      options={options}
      value={value}
      disabled={disabled}
      align={align}
      width={width}
      onChange={setValue}
    />
  );
}

function SelectExample(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="select-states" title="States">
        <Inline>
          <Held label="Theme" options={THEMES} start="system" />
          <Held label="Provider" options={PROVIDERS} start="github" />
          <Held label="Theme" options={THEMES} start="dark" disabled />
        </Inline>
      </CatalogSection>
      <CatalogSection id="select-end" title="Hung from its trailing edge">
        <Stack gap={GAP.CONTROL} align={ALIGN.END}>
          <Held label="Theme" options={THEMES} start="light" align={SELECT_ALIGN.END} />
        </Stack>
      </CatalogSection>
      <CatalogSection id="select-field" title="Field column">
        <Stack gap={GAP.CONTROL} align={ALIGN.END}>
          <Held
            label="Theme"
            options={THEMES}
            start="light"
            align={SELECT_ALIGN.END}
            width={SELECT_WIDTH.FIELD}
          />
          <Held
            label="Provider"
            options={PROVIDERS}
            start="github"
            align={SELECT_ALIGN.END}
            width={SELECT_WIDTH.FIELD}
          />
        </Stack>
      </CatalogSection>
      <CatalogSection id="select-narrow" title="Narrow column, long value">
        <div className="catalog-narrow">
          <Held label="Voice" options={VOICES} start="long" />
        </div>
      </CatalogSection>
    </>
  );
}

export const SELECT_EXAMPLE: Example = { id: "select", title: "Select", Render: SelectExample };
