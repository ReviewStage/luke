import {
  COMBOBOX_LIST_HEIGHT,
  Combobox,
  ComboboxList,
  ComboboxListBox,
  type ComboboxOption,
  ComboboxOptionItem,
  ComposeIcon,
  comboboxOptionId,
  DocumentIcon,
  FolderIcon,
  MARK_PROVIDER,
  ProviderMark,
  SearchField,
  useComboboxField,
} from "@repo/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

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

const MENTIONS: readonly ComboboxOption[] = [
  { id: "readme", label: "README.md", icon: <DocumentIcon />, detail: "docs" },
  { id: "src", label: "src/", icon: <FolderIcon />, detail: "packages/ui" },
  { id: "files", label: "Files and folders", icon: <FolderIcon />, detail: "2 files", opens: true },
];

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

const MODELS: readonly ComboboxOption[] = [
  { id: "opus", label: "Opus", detail: "High", current: true },
  { id: "sonnet", label: "Sonnet", hint: "Not on this plan", disabled: true, current: false },
  { id: "haiku", label: "Haiku", hint: "⌘3", current: false },
];

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

function EngineRows(): React.JSX.Element {
  return (
    <div className="catalog-popover catalog-column">
      <ComboboxListBox aria-label="Results">
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
        <ComboboxOptionItem
          option={{
            id: "task",
            lead: "ACME-42",
            label: "Teammate invitations",
            icon: <DocumentIcon />,
            detail: "relay",
          }}
          aria-selected={false}
        />
      </ComboboxListBox>
    </div>
  );
}

const FILES = Array.from({ length: 12 }, (_, index) => ({
  id: `file-${index}`,
  label: `notes-${index + 1}.md`,
  icon: <DocumentIcon />,
  detail: "docs/notes",
}));

function EngineFill(): React.JSX.Element {
  return (
    <div className="catalog-popover catalog-column catalog-palette">
      <SearchField label="Search files" value="notes" onChange={() => undefined} />
      <ComboboxListBox aria-label="Files" height={COMBOBOX_LIST_HEIGHT.FILL}>
        {FILES.map((option, index) => (
          <ComboboxOptionItem key={option.id} option={option} aria-selected={index === 0} />
        ))}
      </ComboboxListBox>
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
      <CatalogSection id="combobox-engine-rows" title="Rows and a box a list engine owns">
        <EngineRows />
      </CatalogSection>
      <CatalogSection
        id="combobox-engine-fill"
        title="A list engine's box filling a short card, scrolling inside itself"
      >
        <EngineFill />
      </CatalogSection>
    </>
  );
}

export const COMBOBOX_EXAMPLE: Example = {
  id: "combobox",
  title: "Combobox",
  Render: Comboboxes,
};
