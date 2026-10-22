import { ADMIN_METRICS_WINDOW, type AdminMetricsWindow } from "@luke/features/admin-wire";
import {
  ErrorState,
  GAP,
  IconButton,
  MENU_ITEM_MARK,
  Menu,
  type MenuEntry,
  Stack,
  useMenu,
} from "@luke/ui";
import { CalendarRangeIcon, SlidersHorizontalIcon } from "lucide-react";
import { Tooltip } from "../../tooltip.js";

/** Every range a view may read, shortest first. */
const ALL_WINDOWS: readonly AdminMetricsWindow[] = Object.values(ADMIN_METRICS_WINDOW);

/**
 * What a refresh in flight dims, said busy to a reader until the answer
 * lands, under the failure a refresh landed on an answer that stays shown:
 * the numbers on screen are still the last ones actually read, and the
 * failure says the newer read did not arrive, with Retry beside it, which
 * refuses a press while a read is out rather than abort it and start over.
 * What it holds are the page's parts, its sections and whatever leads them,
 * a section's gap apart, as an app page with several sections stands them.
 */
export function Refreshing({
  failure,
  refreshing,
  onRetry,
  children,
}: {
  failure: string | undefined;
  refreshing: boolean;
  onRetry: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const dimmed = (
    <div
      className="transition-opacity duration-(--luke-duration-quick) data-[busy=true]:opacity-50"
      data-busy={refreshing}
      aria-busy={refreshing}
    >
      <Stack gap={GAP.SECTION}>{children}</Stack>
    </div>
  );
  if (failure === undefined) return dimmed;
  return (
    <Stack gap={GAP.SECTION}>
      <ErrorState
        onRetry={() => {
          if (!refreshing) onRetry();
        }}
      >
        Refresh failed. Still showing the earlier answer. {failure}
      </ErrorState>
      {dimmed}
    </Stack>
  );
}

/** What the button and its menu are called, as the Tasks page's View options are. */
const VIEW_OPTIONS = "View options";

/** A time range in words, as the menu offers it and the toolbar says it after the title. */
export function windowWords(windowDays: AdminMetricsWindow): string {
  return `Last ${windowDays} days`;
}

/**
 * A view's options behind one button at its toolbar's end, as the app's Tasks
 * page and Inbox keep theirs (`desktop/tasks-page-options.tsx`): the time
 * range a view reads, a submenu with the one standing checked, and whether
 * admins' own accounts are counted, a switch. A view offers only what it
 * reads: an account's page its range alone, a day's the admins switch alone,
 * and the Workspaces list whether it keeps shared workspaces only beside it. The range standing is said after the title
 * (`windowWords`), since the button does not show it.
 */
export function AdminViewOptions({
  windowDays,
  onWindowDaysChange,
  windows = ALL_WINDOWS,
  hideAdmins,
  onHideAdminsChange,
  sharedOnly,
  onSharedOnlyChange,
}: {
  windowDays?: AdminMetricsWindow | undefined;
  onWindowDaysChange?: ((windowDays: AdminMetricsWindow) => void) | undefined;
  /** The lengths a view offers, where it answers fewer than all three. */
  windows?: readonly AdminMetricsWindow[] | undefined;
  hideAdmins?: boolean | undefined;
  onHideAdminsChange?: ((hide: boolean) => void) | undefined;
  /** Whether a list of workspaces keeps the shared ones alone, its personal ones left out. */
  sharedOnly?: boolean | undefined;
  onSharedOnlyChange?: ((sharedOnly: boolean) => void) | undefined;
}): React.JSX.Element {
  const menu = useMenu(true);
  const groups: MenuEntry[][] = [];
  if (windowDays !== undefined && onWindowDaysChange !== undefined) {
    groups.push([
      {
        label: "Time range",
        icon: <CalendarRangeIcon />,
        items: windows.map((each) => ({
          label: windowWords(each),
          checked: each === windowDays,
          onSelect: () => onWindowDaysChange(each),
        })),
      },
    ]);
  }
  const switches: MenuEntry[] = [];
  if (sharedOnly !== undefined && onSharedOnlyChange !== undefined) {
    switches.push({
      label: "Shared only",
      checked: sharedOnly,
      mark: MENU_ITEM_MARK.SWITCH,
      stays: true,
      onSelect: () => onSharedOnlyChange(!sharedOnly),
    });
  }
  if (hideAdmins !== undefined && onHideAdminsChange !== undefined) {
    switches.push({
      label: "Include admins",
      checked: !hideAdmins,
      mark: MENU_ITEM_MARK.SWITCH,
      stays: true,
      onSelect: () => onHideAdminsChange(!hideAdmins),
    });
  }
  if (switches.length > 0) groups.push(switches);
  return (
    <>
      <Tooltip label={VIEW_OPTIONS}>
        <IconButton icon={<SlidersHorizontalIcon />} label={VIEW_OPTIONS} {...menu.trigger()} />
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <Menu label={VIEW_OPTIONS} menu={menu.drawn} groups={groups} onClose={menu.close} />
      )}
    </>
  );
}
