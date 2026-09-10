import { LukeMark } from "../../SiteChrome";
import { type AdminTab, plainLeftClick, tabHref } from "../routing";

/**
 * The rail's two widths, in pixels, kept here as the single source the drawn
 * `style` reads so the fold's geometry is one value a test can pin rather than
 * a Tailwind class literal it cannot.
 */
const SIDEBAR_WIDTH = {
  EXPANDED: 224,
  COLLAPSED: 62,
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

/**
 * Each row leads with an icon slot exactly the collapsed rail's width. That one
 * choice carries both halves of a clean fold: the icon centred in the slot sits
 * on the rail's own centre, and the label that follows the slot begins at the
 * rail's edge — so when the rail is collapsed the label starts past the clip
 * and no fragment of it shows, without the label ever leaving the flow (which
 * is what would re-flow the row and flicker). A slot narrower than the rail
 * would leave a sliver of the next label inside it; a wider one would push the
 * icon off centre. Tying it to the collapsed width keeps both true at once.
 */
const SIDEBAR_ICON_SLOT = SIDEBAR_WIDTH.COLLAPSED;

/**
 * The hover and active fill cannot be the row's own background: the row is
 * laid out at the expanded width and clipped by the rail, so its background
 * would be sliced mid-pill by the moving clip edge. Each row instead layers a
 * pill of its own, inset by this margin from the rail's left edge and sized by
 * `sidebarPillWidth`, whose width moves between the same two endpoints as the
 * rail's under the same transition. The two width deltas are therefore equal,
 * which is what keeps the pill's rounded right end exactly this margin inside
 * the clip edge at every intermediate width, not only at rest.
 */
const SIDEBAR_PILL_INSET = 8;

function sidebarPillWidth(collapsed: boolean): number {
  return sidebarRailWidth(collapsed) - SIDEBAR_PILL_INSET * 2;
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
 * The pill's fill is scoped here rather than taken from `--muted`: 5% white is
 * a resting tint for flat surfaces, too faint to read as a state on the
 * lifted card the rail sits on, and raising the shared token would brighten
 * every muted surface on the page.
 */
const SIDEBAR_ITEM = {
  ACTIVE: {
    ROW: "text-foreground",
    PILL: "bg-foreground/10",
  },
  IDLE: {
    ROW: "text-muted-foreground hover:text-foreground focus-visible:text-foreground",
    PILL: "group-hover:bg-foreground/10 group-focus-visible:bg-foreground/10",
  },
} as const;

/**
 * The page's one navigation, wearing the brand the headers used to carry.
 * Each tab is a real anchor to its own address, so a modified click still
 * gets the browser's own gesture. On a phone the rail would eat a fifth of
 * the width for two links, so below the page's breakpoint the same
 * navigation stands as a compact top bar instead — two sibling renders
 * rather than one reshaped tree, because the fold below is the rail's own
 * geometry and never reaches the bar's inline labels.
 *
 * The fold is a single width transition on the outer rail over a fixed-width
 * inner panel it clips: the panel is always laid out at the expanded width, so
 * a label is revealed or hidden by the moving clip edge rather than inserted
 * and removed. Nothing inside the panel re-flows as the rail moves, so the
 * fold neither pops a label in nor wraps one nor shoves an icon. Each row
 * leads with an icon slot exactly the collapsed rail's width, so the icon sits
 * on the rail's centre and the label begins at the rail's edge — past the clip,
 * never a fragment inside it — which is why the rows carry no horizontal
 * padding of their own: any would start the label short of that edge. Collapsed,
 * every item keeps its name on a `title` and the toggle on its `aria-label`;
 * the labels themselves stay in the tree, clipped, so a reader still hears them.
 * The same clip is why hover and the active state are drawn by a pill layer
 * sized against the rail (`sidebarPillWidth`) instead of the row's background:
 * the fixed-width row runs under the clip edge, so its background would be
 * sliced there, expanded flush against the borders and collapsed cut mid-pill.
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
  const iconSlot = (icon: React.ReactNode) => (
    <span
      className="relative flex shrink-0 items-center justify-center"
      style={{ width: SIDEBAR_ICON_SLOT }}
      aria-hidden="true"
    >
      {icon}
    </span>
  );

  const pill = (styling: (typeof SIDEBAR_ITEM)[keyof typeof SIDEBAR_ITEM]) => (
    <span
      aria-hidden="true"
      style={{ left: SIDEBAR_PILL_INSET, width: sidebarPillWidth(collapsed) }}
      className={`absolute inset-y-0 rounded-full transition-[width,background-color] duration-150 ease-out motion-reduce:transition-none ${styling.PILL}`}
    />
  );

  const item = (tab: AdminTab, label: string, icon: React.ReactNode) => {
    const styling = active === tab ? SIDEBAR_ITEM.ACTIVE : SIDEBAR_ITEM.IDLE;
    return (
      <a
        href={tabHref(tab)}
        aria-current={active === tab ? "page" : undefined}
        title={collapsed ? label : undefined}
        className={`group relative flex min-h-11 items-center py-2 pr-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-none ${styling.ROW}`}
        onClick={(event) => {
          if (!plainLeftClick(event)) return;
          event.preventDefault();
          onNavigate(tab);
        }}
      >
        {pill(styling)}
        {iconSlot(icon)}
        <span className="relative min-w-0 whitespace-nowrap">{label}</span>
      </a>
    );
  };

  const barItem = (tab: AdminTab, label: string, icon: React.ReactNode) => {
    const styling = active === tab ? SIDEBAR_ITEM.ACTIVE : SIDEBAR_ITEM.IDLE;
    return (
      <a
        href={tabHref(tab)}
        aria-label={label}
        aria-current={active === tab ? "page" : undefined}
        className={`group relative flex min-h-11 min-w-0 items-center justify-center px-2 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none min-[520px]:px-2.5 ${styling.ROW}`}
        onClick={(event) => {
          if (!plainLeftClick(event)) return;
          event.preventDefault();
          onNavigate(tab);
        }}
      >
        {/* The bar never folds, so the rail's pill needs no width of its own
            here: the same fills simply cover the item. */}
        <span
          aria-hidden="true"
          className={`absolute inset-0 rounded-full transition-[background-color] duration-150 ${styling.PILL}`}
        />
        <span className="relative flex min-w-0 items-center gap-2.5">
          {icon}
          <span className="hidden truncate min-[520px]:inline">{label}</span>
        </span>
      </a>
    );
  };

  return (
    <>
      <nav
        aria-label="Admin sections"
        className="grid grid-cols-[auto_repeat(3,minmax(0,1fr))] items-center gap-1 border-b border-border bg-card px-3 py-2 min-[720px]:hidden"
      >
        <span className="mr-1 inline-flex w-6 shrink-0 text-foreground" aria-hidden="true">
          <LukeMark className="h-auto w-full" />
        </span>
        {barItem("dashboard", "Dashboard", <DashboardIcon />)}
        {barItem("users", "Users", <UsersIcon />)}
        {barItem("animations", "Animations", <AnimationsIcon />)}
      </nav>
      <nav
        aria-label="Admin sections"
        style={{ width: sidebarRailWidth(collapsed) }}
        className="sticky top-0 hidden h-screen shrink-0 overflow-hidden border-r border-border bg-card transition-[width] duration-150 ease-out min-[720px]:flex motion-reduce:transition-none"
      >
        <div
          style={{ width: SIDEBAR_WIDTH.EXPANDED }}
          className="flex h-full shrink-0 flex-col py-5"
        >
          <div className="flex items-center pr-3">
            {iconSlot(
              <span className="inline-flex w-6 text-foreground">
                <LukeMark className="h-auto w-full" />
              </span>,
            )}
            <span className="whitespace-nowrap font-brand text-base font-bold tracking-[-0.01em]">
              Luke admin
            </span>
          </div>
          <div className="mt-8 grid gap-1">
            {item("dashboard", "Dashboard", <DashboardIcon />)}
            {item("users", "Users", <UsersIcon />)}
            {item("animations", "Animations", <AnimationsIcon />)}
          </div>
          <div className="flex-1" />
          <button
            type="button"
            aria-label={sidebarToggleLabel(collapsed)}
            className={`group relative flex min-h-11 cursor-pointer items-center py-2 pr-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-none ${SIDEBAR_ITEM.IDLE.ROW}`}
            onClick={onToggle}
          >
            {pill(SIDEBAR_ITEM.IDLE)}
            {iconSlot(<CollapseIcon collapsed={collapsed} />)}
            <span className="relative whitespace-nowrap">Collapse</span>
          </button>
        </div>
      </nav>
    </>
  );
}
