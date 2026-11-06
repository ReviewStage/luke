import { ADMIN_METRICS_WINDOW, type AdminMetricsWindow } from "@repo/features/admin-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  ErrorState,
  GAP,
  IconButton,
  MENU_ITEM_MARK,
  Menu,
  type MenuEntry,
  Stack,
  Tooltip,
  useMenu,
} from "@repo/ui";
import { CalendarRangeIcon, SlidersHorizontalIcon } from "lucide-react";
import { unreadShown } from "../../failure-report.js";

const ALL_WINDOWS: readonly AdminMetricsWindow[] = Object.values(ADMIN_METRICS_WINDOW);

export function PageSections({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <Stack gap={GAP.SECTION}>{children}</Stack>;
}

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
      className="transition-opacity duration-(--ui-duration-quick) ease-motion-exit data-[busy=true]:opacity-50"
      data-busy={refreshing}
      aria-busy={refreshing}
    >
      <PageSections>{children}</PageSections>
    </div>
  );
  if (failure === undefined) return dimmed;
  return (
    <Stack gap={GAP.SECTION}>
      <ErrorState
        failure={unreadShown(FAILURE_SURFACE.ADMIN_REFRESH)}
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

const VIEW_OPTIONS = "View options";

export function windowWords(windowDays: AdminMetricsWindow): string {
  return `Last ${windowDays} days`;
}

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
  windows?: readonly AdminMetricsWindow[] | undefined;
  hideAdmins?: boolean | undefined;
  onHideAdminsChange?: ((hide: boolean) => void) | undefined;
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
