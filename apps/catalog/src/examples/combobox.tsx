import {
  Combobox,
  ComboboxList,
  type ComboboxOption,
  ComboboxOptionItem,
  ComposeIcon,
  comboboxOptionId,
  DocumentIcon,
  FolderIcon,
  MARK_PROVIDER,
  ProviderMark,
  useComboboxField,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * combobox.tsx -- a Combobox narrowing synthetic issues under a heading, with
 * the words as typed offered after them, open on a query; in a narrow
 * column with a long title; and a list standing alone on a popover, as an
 * editor's `@` hangs one, a row that opens a further list wearing its
 * chevron, and its note where nothing matches; and a list too short to
 * search, holding the keys itself, with a model that cannot be chosen now,
 * the one chosen checked, and a note after them; and rows a list engine of
 * the app's owns, each drawn as `ComboboxOptionItem`, the second lit as the
 * engine's `aria-selected` says.
 */

/** Synthetic issues, as a tracker would list them. */
const ISSUES = [
  { id: "eng-1", key: "ENG-1", title: "Restack the deploy queue", state: "Todo" },
  {
    id: "eng-2",
    key: "ENG-2",
    title: "Add support for stacked pull requests",
    state: "In Progress",
  },
  { id: "ops-7", key: "OPS-7", title: "Rotate the deploy key", state: "Backlog" },
] as const;

/** A field over the issues its words match, holding its own words and active option as a caller would. */
function Issues({ start }: { start: string }): React.JSX.Element {
  const [value, setValue] = useState(start);
  const [active, setActive] = useState(0);
  const [shut, setShut] = useState(false);
  const words = value.trim().toLowerCase();
  const issues: ComboboxOption[] = ISSUES.filter(
    (issue) => words !== "" && issue.title.toLowerCase().includes(words),
  ).map((issue) => ({
    id: issue.id,
    label: issue.title,
    icon: <ProviderMark provider={MARK_PROVIDER.LINEAR} />,
    detail: `${issue.key} · ${issue.state}`,
  }));
  const typed: ComboboxOption = {
    id: "typed",
    label: `Create task “${value.trim()}”`,
    icon: <ComposeIcon />,
    hint: "⌘⏎",
  };
  return (
    <Combobox
      label="Task name"
      listLabel="Issues"
      placeholder="Task name, or search issues"
      value={value}
      onChange={(next) => {
        setValue(next);
        setActive(0);
        setShut(false);
      }}
      groups={[{ label: "Issues", options: issues }, { options: [typed] }]}
      open={!shut && issues.length > 0}
      active={active}
      onActiveChange={setActive}
      onChoose={() => setShut(true)}
      onEscape={() => setShut(true)}
    />
  );
}

/** Synthetic mentions, as an editor's `@` would offer them: a file, a folder, and the kind a press narrows to. */
const MENTIONS: readonly ComboboxOption[] = [
  { id: "readme", label: "README.md", icon: <DocumentIcon />, detail: "docs" },
  { id: "src", label: "src/", icon: <FolderIcon />, detail: "packages/ui" },
  { id: "files", label: "Files and folders", icon: <FolderIcon />, detail: "2 files", opens: true },
];

/** A list standing alone over `options`, holding its own active option as an editor's caller would. */
function Mentions({ options }: { options: readonly ComboboxOption[] }): React.JSX.Element {
  const [active, setActive] = useState(0);
  return (
    <div className="catalog-popover catalog-column">
      <ComboboxList
        label="Mention"
        groups={options.length === 0 ? [] : [{ label: "Files and folders", options }]}
        active={active}
        onActiveChange={setActive}
        onChoose={setActive}
        empty="Nothing matches"
      />
    </div>
  );
}

/** Synthetic models, as a picker would list them: one not on the plan, and the one chosen. */
const MODELS: readonly ComboboxOption[] = [
  { id: "opus", label: "Opus", detail: "High", current: true },
  { id: "sonnet", label: "Sonnet", hint: "Not on this plan", disabled: true, current: false },
  { id: "haiku", label: "Haiku", hint: "⌘3", current: false },
];

/** A list with no field, steering itself as a picker too short to search does. */
function Models(): React.JSX.Element {
  const [active, setActive] = useState(0);
  const keys = useComboboxField({
    open: true,
    active,
    count: MODELS.length,
    skipped: (index) => MODELS[index]?.disabled === true,
    controls: "catalog-models",
    activeId: comboboxOptionId("catalog-models", active),
    onActiveChange: setActive,
    onChoose: setActive,
  });
  return (
    <div className="catalog-popover catalog-column">
      <ComboboxList
        id="catalog-models"
        label="Model"
        groups={[{ label: "Models", options: MODELS }]}
        active={active}
        onActiveChange={setActive}
        onChoose={setActive}
        steer={keys}
        note="Reading more models…"
      />
    </div>
  );
}

/** Rows as a list engine (cmdk) would hand them through its `asChild`, the second the engine's selected one. */
function EngineRows(): React.JSX.Element {
  return (
    <div className="catalog-popover catalog-column" role="listbox" aria-label="Results">
      <ComboboxOptionItem
        option={{ id: "new-task", label: "New task", icon: <ComposeIcon />, hint: "⌘N" }}
        aria-selected={false}
      />
      <ComboboxOptionItem
        option={{ id: "readme", label: "README.md", icon: <DocumentIcon />, detail: "docs" }}
        aria-selected
      />
      <ComboboxOptionItem
        option={{ id: "src", label: "src/", icon: <FolderIcon />, detail: "packages/ui" }}
        aria-selected={false}
      />
    </div>
  );
}

function Comboboxes(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="combobox-open" title="Narrowing issues, the words as typed after them">
        <div className="catalog-column">
          <Issues start="deploy" />
        </div>
      </CatalogSection>
      <CatalogSection id="combobox-narrow" title="Narrow column, long title">
        <div className="catalog-narrow">
          <Issues start="stacked" />
        </div>
      </CatalogSection>
      <CatalogSection id="combobox-list" title="A list standing alone, under an editor's words">
        <Mentions options={MENTIONS} />
      </CatalogSection>
      <CatalogSection id="combobox-list-empty" title="A list standing alone, nothing matching">
        <Mentions options={[]} />
      </CatalogSection>
      <CatalogSection
        id="combobox-list-steered"
        title="A list with no field: a dimmed option, the chosen one, and a note"
      >
        <Models />
      </CatalogSection>
      <CatalogSection id="combobox-engine-rows" title="Rows a list engine owns">
        <EngineRows />
      </CatalogSection>
    </>
  );
}

export const COMBOBOX_EXAMPLE: Example = {
  id: "combobox",
  title: "Combobox",
  Render: Comboboxes,
};
