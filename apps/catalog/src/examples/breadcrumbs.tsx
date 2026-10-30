import { TASK_STATUS } from "@luke/features/task-wire";
import {
  BREADCRUMB_POPUP,
  BREADCRUMB_SHOWN,
  BREADCRUMBS_VARIANT,
  BreadcrumbBar,
  Breadcrumbs,
  type Crumb,
  FolderIcon,
  GAP,
  Stack,
  TaskStatusMark,
  UserIcon,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * breadcrumbs.tsx -- a bar's path at a wide, a narrow, and the narrowest
 * width, its middle folders and then every folder standing as one "…",
 * each crumb's press marking it open; a long path cut short; a path whose
 * crumbs wear a glyph before their words; a toolbar's heading, its way
 * back then the page's name, folded and not; and a window's title bar,
 * every crumb a quiet press, its tasks by status mark, name, and key, drawn
 * wide and narrow.
 */

const REPOSITORY = "acme/relay";
const FOLDERS = ["packages", "db", "src"] as const;
const FILE = "accept-invite.ts";

/** A child task's path in a window's title bar: its repository, its parent, then the task, each task by status mark, name, and key. */
const TITLE_BAR: Crumb[] = [
  {
    label: REPOSITORY,
    glyph: <FolderIcon />,
    popup: BREADCRUMB_POPUP.DIALOG,
    onPress: () => undefined,
  },
  {
    label: "Ship the invite flow",
    glyph: <TaskStatusMark status={TASK_STATUS.IN_PROGRESS} />,
    detail: "REL-120",
    onPress: () => undefined,
  },
  {
    label: "Members who accept an invite twice land in the workspace twice",
    glyph: <TaskStatusMark status={TASK_STATUS.TODO} />,
    detail: "REL-128",
    current: true,
    onPress: () => undefined,
  },
];

/** A bar's path to `FILE`, the crumb pressed last marked open. */
function FilePath(): React.JSX.Element {
  const [open, setOpen] = useState<number | undefined>(undefined);
  const press = (at: number) => () => setOpen(open === at ? undefined : at);
  const pressed = (at: number) => ({
    popup: BREADCRUMB_POPUP.DIALOG,
    expanded: open === at,
    onPress: press(at),
  });
  const crumbs: Crumb[] = [
    {
      label: "…",
      name: `Folders: ${[REPOSITORY, ...FOLDERS].join("/")}`,
      shownAt: BREADCRUMB_SHOWN.NARROWEST,
      ...pressed(-2),
    },
    { label: REPOSITORY, shownAt: BREADCRUMB_SHOWN.WIDE_OR_NARROW, ...pressed(0) },
    {
      label: "…",
      name: `Folders: ${FOLDERS.slice(0, 2).join("/")}`,
      shownAt: BREADCRUMB_SHOWN.NARROW,
      ...pressed(-1),
    },
    { label: "packages", shownAt: BREADCRUMB_SHOWN.WIDE, ...pressed(1) },
    { label: "db", shownAt: BREADCRUMB_SHOWN.WIDE, ...pressed(2) },
    { label: "src", shownAt: BREADCRUMB_SHOWN.WIDE_OR_NARROW, ...pressed(3) },
    { label: FILE, current: true, ...pressed(4) },
  ];
  return (
    <BreadcrumbBar>
      <Breadcrumbs label="Path" crumbs={crumbs} />
    </BreadcrumbBar>
  );
}

function BreadcrumbsExample(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="breadcrumbs-bar" title="A bar's path, wide, narrow, and narrowest">
        <Stack gap={GAP.CONTROL}>
          <div className="catalog-crumb-bar">
            <FilePath />
          </div>
          <div className="catalog-crumb-bar catalog-crumb-bar-narrow">
            <FilePath />
          </div>
          <div className="catalog-crumb-bar catalog-crumb-bar-narrowest">
            <FilePath />
          </div>
        </Stack>
      </CatalogSection>
      <CatalogSection id="breadcrumbs-long" title="Long names cut short">
        <div className="catalog-crumb-bar catalog-crumb-bar-narrow">
          <BreadcrumbBar>
            <Breadcrumbs
              label="Path"
              crumbs={[
                { label: "an-organisation-with-a-long-name/a-repository-named-at-length" },
                { label: "a-folder-whose-name-runs-on", fixed: true },
                { label: "a-file-whose-name-runs-on-past-its-bar.ts", current: true },
              ]}
            />
          </BreadcrumbBar>
        </div>
      </CatalogSection>
      <CatalogSection id="breadcrumbs-glyphs" title="Crumbs wearing a glyph">
        <div className="catalog-crumb-bar">
          <BreadcrumbBar>
            <Breadcrumbs
              label="Path"
              crumbs={[
                { label: "Ship the invite flow", glyph: <FolderIcon />, onPress: () => undefined },
                { label: "Fix the double invite", glyph: <UserIcon />, onPress: () => undefined },
              ]}
            />
          </BreadcrumbBar>
        </div>
      </CatalogSection>
      <CatalogSection id="breadcrumbs-title" title="A toolbar's heading, drawn and folded">
        <Stack gap={GAP.CONTROL}>
          <Breadcrumbs
            label="Path"
            variant={BREADCRUMBS_VARIANT.TITLE}
            crumbs={[
              { label: "Issues", icon: <FolderIcon />, onPress: () => undefined },
              { label: "REL-128", current: true },
            ]}
          />
          <div className="catalog-folded catalog-column">
            <Breadcrumbs
              label="Path"
              variant={BREADCRUMBS_VARIANT.TITLE}
              crumbs={[
                { label: "Issues", icon: <FolderIcon />, onPress: () => undefined },
                {
                  label: "Members who accept an invite twice land in the workspace twice",
                  current: true,
                },
              ]}
            />
          </div>
        </Stack>
      </CatalogSection>
      <CatalogSection
        id="breadcrumbs-control"
        title="A window's title bar: every crumb a quiet press"
      >
        <Stack gap={GAP.CONTROL}>
          <Breadcrumbs label="Path" variant={BREADCRUMBS_VARIANT.CONTROL} crumbs={TITLE_BAR} />
          <div className="catalog-narrow">
            <Breadcrumbs label="Path" variant={BREADCRUMBS_VARIANT.CONTROL} crumbs={TITLE_BAR} />
          </div>
        </Stack>
      </CatalogSection>
    </>
  );
}

export const BREADCRUMBS_EXAMPLE: Example = {
  id: "breadcrumbs",
  title: "Breadcrumbs",
  Render: BreadcrumbsExample,
};
