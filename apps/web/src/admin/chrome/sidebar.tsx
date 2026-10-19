import { IconButton, NAV_CURRENT, NavItemLink } from "@luke/ui";
import { LukeMark, WORDMARK } from "../../SiteChrome";
import { type AdminTab, plainLeftClick, tabHref } from "../routing";

/**
 * The rail's two widths, in pixels, kept here as the single source the drawn
 * `style` reads. Collapsed, the rail is a row's glyph-alone pill and the
 * column's inset either side of it, so the icon stands on the rail's centre.
 */
const SIDEBAR_WIDTH = {
  EXPANDED: 224,
  COLLAPSED: 64,
} as const;

type SidebarWidth = (typeof SIDEBAR_WIDTH)[keyof typeof SIDEBAR_WIDTH];

function sidebarRailWidth(collapsed: boolean): SidebarWidth {
  return collapsed ? SIDEBAR_WIDTH.COLLAPSED : SIDEBAR_WIDTH.EXPANDED;
}

/**
 * What the fold toggle names for a reader, distinct from the chevron it draws:
 * collapsed it offers to expand, expanded to collapse. The icon carries the
 * direction; this carries the word.
 */
const SIDEBAR_TOGGLE_LABEL = {
  EXPAND: "Expand sidebar",
  COLLAPSE: "Collapse sidebar",
} as const;

function sidebarToggleLabel(collapsed: boolean): string {
  return collapsed ? SIDEBAR_TOGGLE_LABEL.EXPAND : SIDEBAR_TOGGLE_LABEL.COLLAPSE;
}

function DashboardIcon(): React.JSX.Element {
  return (
    <svg
      className="size-4 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <rect x="1.75" y="1.75" width="5" height="5" rx="1" />
      <rect x="9.25" y="1.75" width="5" height="5" rx="1" />
      <rect x="1.75" y="9.25" width="5" height="5" rx="1" />
      <rect x="9.25" y="9.25" width="5" height="5" rx="1" />
    </svg>
  );
}

function CostIcon(): React.JSX.Element {
  return (
    <svg
      className="size-4 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.25" />
      <path d="M10 5.9c-.4-.6-1.1-.9-2-.9-1.2 0-2 .6-2 1.5 0 2 4 1 4 3 0 .9-.8 1.5-2 1.5-.9 0-1.6-.3-2-.9M8 3.9V5M8 11v1.1" />
    </svg>
  );
}

/** A workspace as a stack of shared layers, apart from the Users glyph's one person. */
function WorkspacesIcon(): React.JSX.Element {
  return (
    <svg
      className="size-4 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 1.9 14.1 5 8 8.1 1.9 5 8 1.9Z" />
      <path d="M1.9 8 8 11.1 14.1 8" />
      <path d="M1.9 11 8 14.1 14.1 11" />
    </svg>
  );
}

/** A pulse line across the glyph: the service's health over time. */
function ReliabilityIcon(): React.JSX.Element {
  return (
    <svg
      className="size-4 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.5 8.5h3l1.75-4.5 3.5 8 1.75-3.5h3" />
    </svg>
  );
}

function UsersIcon(): React.JSX.Element {
  return (
    <svg
      className="size-4 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="6" cy="5.1" r="2.35" />
      <path d="M1.9 13.4c.6-2.4 2.2-3.7 4.1-3.7s3.5 1.3 4.1 3.7" />
      <path d="M10.6 3a2.35 2.35 0 0 1 0 4.2" />
      <path d="M11.8 10c1.3.5 2 1.6 2.3 3.4" />
    </svg>
  );
}

/** Luke's own face, traced from `FACE_ART` onto the sidebar's 16-unit grid. */
function AnimationsIcon(): React.JSX.Element {
  return (
    <svg className="size-4 shrink-0" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <g transform="rotate(-8 8 8)">
        <path
          d="M 6.5 4.6 V 10.2 Q 6.5 11.4 7.7 11.4 Q 9.6 11.4 12 9.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="4.3" cy="5.25" r="1.05" fill="currentColor" />
        <circle cx="11.5" cy="5.25" r="1.05" fill="currentColor" />
      </g>
    </svg>
  );
}

/** Points at the sidebar's own edge: left to fold it away, right to bring it back. */
function CollapseIcon({ collapsed }: { collapsed: boolean }): React.JSX.Element {
  return (
    <svg
      className="size-4 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {collapsed ? <path d="M6 3.5 10.5 8 6 12.5" /> : <path d="M10 3.5 5.5 8l4.5 4.5" />}
    </svg>
  );
}

/**
 * The page's one navigation, wearing the brand the headers used to carry.
 * Each tab is a real anchor to its own address, so a modified click still
 * gets the browser's own gesture. On a phone the rail would eat a fifth of
 * the width for two links, so below the page's breakpoint the same
 * navigation stands as a compact top bar instead, its labels left to the
 * icons' accessible names on the narrowest screens.
 *
 * The fold is a single width transition on the rail, whose column keeps one
 * inset in both states: the rows narrow with it until each is its glyph's
 * pill alone, the icon never moving off the rail's centre, and the names give
 * way as the row narrows rather than leaving the tree, so a reader still hears
 * them; collapsed, each row keeps its name on a `title` as well. The brand
 * and the toggle stand on the same inset, the toggle at the column's end, so
 * collapsed it too is centred on the rail.
 */
export function AdminSidebar({
  active,
  collapsed,
  onToggle,
  onNavigate,
}: {
  active: AdminTab;
  collapsed: boolean;
  onToggle: () => void;
  onNavigate: (tab: AdminTab) => void;
}): React.JSX.Element {
  const go = (tab: AdminTab) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!plainLeftClick(event)) return;
    event.preventDefault();
    onNavigate(tab);
  };

  const current = (tab: AdminTab) => (active === tab ? NAV_CURRENT.PAGE : undefined);

  const item = (tab: AdminTab, label: string, icon: React.ReactNode) => (
    <NavItemLink
      href={tabHref(tab)}
      icon={icon}
      current={current(tab)}
      title={collapsed ? label : undefined}
      onClick={go(tab)}
    >
      {label}
    </NavItemLink>
  );

  // Note that the bar's icon rides in the name, not the glyph's cell, so
  // with its label hidden on the narrowest screens it stands centred in its pill.
  const barItem = (tab: AdminTab, label: string, icon: React.ReactNode) => (
    <span className="min-w-0 justify-self-center">
      <NavItemLink href={tabHref(tab)} aria-label={label} current={current(tab)} onClick={go(tab)}>
        <span className="flex items-center gap-2">
          {icon}
          <span className="hidden min-[520px]:inline">{label}</span>
        </span>
      </NavItemLink>
    </span>
  );

  return (
    <>
      <nav
        aria-label="Admin sections"
        className="grid grid-cols-[auto_repeat(6,minmax(0,1fr))] items-center gap-1 border-b border-(--luke-color-border) bg-(--luke-color-surface) px-3 py-2 min-[720px]:hidden"
      >
        <span className="mr-1 inline-flex w-6 shrink-0 text-(--luke-color-text)" aria-hidden="true">
          <LukeMark className="h-auto w-full" />
        </span>
        {barItem("dashboard", "Dashboard", <DashboardIcon />)}
        {barItem("cost", "Cost", <CostIcon />)}
        {barItem("reliability", "Reliability", <ReliabilityIcon />)}
        {barItem("workspaces", "Workspaces", <WorkspacesIcon />)}
        {barItem("users", "Users", <UsersIcon />)}
        {barItem("animations", "Animations", <AnimationsIcon />)}
      </nav>
      <nav
        aria-label="Admin sections"
        style={{ width: sidebarRailWidth(collapsed) }}
        className="hidden h-full shrink-0 flex-col overflow-hidden border-r border-(--luke-color-border) bg-(--luke-color-surface) py-5 transition-[width] duration-150 ease-out min-[720px]:flex motion-reduce:transition-none"
      >
        <div className="flex items-center gap-2 px-4">
          <span
            className="flex w-8 shrink-0 justify-center text-(--luke-color-text)"
            aria-hidden="true"
          >
            <span className="inline-flex w-6">
              <LukeMark className="h-auto w-full" />
            </span>
          </span>
          <span className={`min-w-0 overflow-hidden whitespace-nowrap ${WORDMARK}`}>
            Luke admin
          </span>
        </div>
        <div className="mt-8 grid gap-1 px-4">
          {item("dashboard", "Dashboard", <DashboardIcon />)}
          {item("cost", "Cost", <CostIcon />)}
          {item("reliability", "Reliability", <ReliabilityIcon />)}
          {item("workspaces", "Workspaces", <WorkspacesIcon />)}
          {item("users", "Users", <UsersIcon />)}
          {item("animations", "Animations", <AnimationsIcon />)}
        </div>
        <div className="flex-1" />
        <div className="flex justify-end px-4">
          <IconButton
            icon={<CollapseIcon collapsed={collapsed} />}
            label={sidebarToggleLabel(collapsed)}
            onClick={onToggle}
          />
        </div>
      </nav>
    </>
  );
}
