import {
  BUTTON_VARIANT,
  Button,
  DETAIL_PAGE_INSET,
  DetailPage,
  EllipsisIcon,
  GAP,
  IconButton,
  PAGE_FRAME,
  PencilIcon,
  Stack,
  TABS_INSET,
  Tabs,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * detail-page.tsx -- one thing's page with a secondary column beside its
 * main content, each scrolling on its own; the same page with no secondary
 * column; and the page in a phone's width, where the secondary column
 * follows the main content in the one scroll; and the page under a window's
 * toolbar, which holds its title and acts; and the page in a side panel
 * under its tabs, its words at the tabs' column inset. Every name is made up.
 */

const SECTIONS = [
  {
    id: "goal",
    title: "Goal",
    body: "Move every workspace onto the new runners without a pause in anyone's work.",
  },
  {
    id: "steps",
    title: "Steps",
    body: "Drain one region at a time, watch the queue for a day, then move the next.",
  },
  {
    id: "risks",
    title: "Risks",
    body: "A long-running agent could be cut off mid-turn if its runner drains too early.",
  },
  {
    id: "rollback",
    title: "Rollback",
    body: "Point the region back at the old runners; nothing is deleted until the last one moves.",
  },
  {
    id: "notes",
    title: "Notes",
    body: "Ada owns the drain order. Grace reviews the queue graphs each morning.",
  },
  {
    id: "open",
    title: "Open questions",
    body: "Whether the acme-corporation-engineering-platform workspace needs a window of its own.",
  },
] as const;

const TITLE = "Migrate the workspaces onto the new runners";

const FACTS = [
  { id: "owner", label: "Owner", value: "Ada Lovelace" },
  { id: "workspace", label: "Workspace", value: "acme-corporation-engineering-platform" },
  { id: "created", label: "Created", value: "12 October" },
  { id: "edited", label: "Last edited", value: "2h ago by Grace Hopper" },
  { id: "status", label: "Status", value: "In progress" },
] as const;

function Sections(): React.JSX.Element {
  return (
    <Stack gap={GAP.SECTION}>
      {SECTIONS.map((section) => (
        <Stack key={section.id} gap={GAP.TIGHT}>
          <Text variant={TEXT_VARIANT.SECTION} as={TEXT_ELEMENT.H2}>
            {section.title}
          </Text>
          <Text>{section.body}</Text>
        </Stack>
      ))}
    </Stack>
  );
}

function Facts(): React.JSX.Element {
  return (
    <Stack gap={GAP.FIELD}>
      {FACTS.map((fact) => (
        <Stack key={fact.id} gap={GAP.NONE}>
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {fact.label}
          </Text>
          <Text variant={TEXT_VARIANT.LABEL}>{fact.value}</Text>
        </Stack>
      ))}
    </Stack>
  );
}

function Task({ secondary }: { secondary: boolean }): React.JSX.Element {
  return (
    <DetailPage
      title={TITLE}
      description="A task in the platform workspace."
      actions={
        <>
          <Button variant={BUTTON_VARIANT.OUTLINE} icon={<PencilIcon />}>
            Edit
          </Button>
          <IconButton icon={<EllipsisIcon />} label="More for this task" />
        </>
      }
      secondary={secondary ? { label: "Details", content: <Facts /> } : undefined}
    >
      <Sections />
    </DetailPage>
  );
}

function TaskUnderToolbar(): React.JSX.Element {
  return (
    <DetailPage
      frame={PAGE_FRAME.TOOLBAR}
      label={TITLE}
      toolbar={
        <header className="catalog-window-toolbar">
          <h1 className="catalog-window-toolbar-title">{TITLE}</h1>
          <Button variant={BUTTON_VARIANT.OUTLINE} icon={<PencilIcon />}>
            Edit
          </Button>
          <IconButton icon={<EllipsisIcon />} label="More for this task" />
        </header>
      }
      secondary={{ label: "Details", content: <Facts /> }}
    >
      <Sections />
    </DetailPage>
  );
}

/** The tabs a side panel's page stands under, as a pull request's do. */
const PANEL_TABS = [
  { value: "conversation", label: "Conversation" },
  { value: "checks", label: "Checks" },
] as const;

function TaskInPanel(): React.JSX.Element {
  return (
    <DetailPage
      frame={PAGE_FRAME.TOOLBAR}
      label="Conversation"
      inset={DETAIL_PAGE_INSET.READING}
      toolbar={
        <Tabs
          label="Task"
          tabs={PANEL_TABS}
          value="conversation"
          onChange={() => undefined}
          ids={(value) => ({ tab: `panel-${value}-tab`, panel: `panel-${value}-panel` })}
          inset={TABS_INSET.READING}
        />
      }
    >
      <Sections />
    </DetailPage>
  );
}

function DetailPages(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="detail-page-secondary" title="With a secondary column">
        <div className="catalog-screen catalog-screen-detail">
          <Task secondary />
        </div>
      </CatalogSection>
      <CatalogSection id="detail-page-main" title="The main content alone">
        <div className="catalog-screen catalog-screen-detail">
          <Task secondary={false} />
        </div>
      </CatalogSection>
      <CatalogSection
        id="detail-page-phone"
        title="A phone's width, the secondary column following"
      >
        <div className="catalog-screen catalog-screen-phone catalog-screen-detail">
          <Task secondary />
        </div>
      </CatalogSection>
      <CatalogSection id="detail-page-toolbar" title="Under the window's toolbar">
        <div className="catalog-screen catalog-screen-detail">
          <TaskUnderToolbar />
        </div>
      </CatalogSection>
      <CatalogSection id="detail-page-reading" title="In a side panel, at its tabs' inset">
        <div className="catalog-screen catalog-screen-panel catalog-screen-detail">
          <TaskInPanel />
        </div>
      </CatalogSection>
    </>
  );
}

export const DETAIL_PAGE_EXAMPLE: Example = {
  id: "detail-page",
  title: "Detail page",
  Render: DetailPages,
};
