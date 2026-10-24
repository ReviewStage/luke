import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BreadcrumbBar,
  Breadcrumbs,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  IconButton,
  PaneBar,
  type PaneBarMenu,
  TerminalIcon,
  Tooltip,
} from "@luke/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * pane-bars.tsx -- a tab's bar led by a title with a quiet detail, its
 * actions and its ⋯; one whose middle holds Back and Forward before a
 * path's crumbs; one led by a glyph and where a connection stands; and a
 * narrow bar, whose title fades where the bar cuts it rather than wrapping.
 */

/** A press the catalog has nowhere to take. */
function stay(): void {}

const PAGE_TITLE = "Quarterly review of the onboarding funnel";

const PAGE_MENU: PaneBarMenu = {
  label: "Page actions",
  groups: [
    [
      { label: "Copy link", icon: <CopyIcon />, onSelect: stay },
      { label: "Save as…", icon: <DownloadIcon />, onSelect: stay },
    ],
  ],
};

const FILE_MENU: PaneBarMenu = {
  label: "File actions",
  groups: [[{ label: "Copy path", icon: <CopyIcon />, onSelect: stay }]],
};

function ViewSource(): React.JSX.Element {
  return (
    <Tooltip label="View source">
      <IconButton icon={<CodeIcon />} label="View source" onClick={stay} />
    </Tooltip>
  );
}

function History(): React.JSX.Element {
  return (
    <>
      <Tooltip label="Back">
        <IconButton icon={<ArrowLeftIcon />} label="Back" onClick={stay} />
      </Tooltip>
      <Tooltip label="Forward">
        <IconButton icon={<ArrowRightIcon />} label="Forward" disabled onClick={stay} />
      </Tooltip>
    </>
  );
}

function PaneBars(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="pane-bar-page" title="A title, its detail, actions and ⋯">
        <PaneBar
          title={PAGE_TITLE}
          detail="Version 2 of 3"
          actions={<ViewSource />}
          menu={PAGE_MENU}
        />
      </CatalogSection>
      <CatalogSection id="pane-bar-crumbs" title="A middle of Back, Forward and crumbs">
        <PaneBar
          middle={
            <BreadcrumbBar>
              <History />
              <Breadcrumbs
                label="Path"
                crumbs={[
                  { label: "acme/relay" },
                  { label: "src" },
                  { label: "accept-invite.ts", current: true },
                ]}
              />
            </BreadcrumbBar>
          }
          menu={FILE_MENU}
        />
      </CatalogSection>
      <CatalogSection id="pane-bar-mark" title="A mark and where a connection stands">
        <PaneBar
          mark={<TerminalIcon aria-hidden="true" />}
          title="acme/relay"
          detail="· this Mac · Connected"
        />
      </CatalogSection>
      <CatalogSection id="pane-bar-narrow" title="A narrow bar fades its title">
        <div className="catalog-narrow">
          <PaneBar title={PAGE_TITLE} actions={<ViewSource />} menu={PAGE_MENU} />
        </div>
      </CatalogSection>
    </>
  );
}

export const PANE_BARS_EXAMPLE: Example = {
  id: "pane-bars",
  title: "Pane bars",
  Render: PaneBars,
};
