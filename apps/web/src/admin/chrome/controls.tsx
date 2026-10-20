import { ADMIN_METRICS_WINDOW, type AdminMetricsWindow } from "@luke/service/admin/http";
import { CHOICE_BAR_LOOK, Checkbox, ChoiceBar, ErrorState, Stack } from "@luke/ui";

/** A window by the constant's own name for it, which is how the segmented control keys its options. */
type WindowName = keyof typeof ADMIN_METRICS_WINDOW;

const WINDOW_OPTIONS = Object.entries(ADMIN_METRICS_WINDOW).map(([name, windowDays]) => ({
  // SAFETY: `Object.entries` widens the constant's own keys to string.
  value: name as WindowName,
  label: `${windowDays}d`,
}));

/**
 * What a refresh in flight dims, said busy to a reader until the answer
 * lands, under the failure a refresh landed on an answer that stays shown:
 * the numbers on screen are still the last ones actually read, and the
 * failure says the newer read did not arrive, with Retry beside it, which
 * refuses a press while a read is out rather than abort it and start over.
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
      className="transition-opacity duration-(--duration-quick) data-[busy=true]:opacity-50"
      data-busy={refreshing}
      aria-busy={refreshing}
    >
      {children}
    </div>
  );
  if (failure === undefined) return dimmed;
  return (
    <Stack>
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

/**
 * The window every windowed read answers to, as one control of fixed
 * lengths, three unless the screen offers fewer. The choice lives in the address bar, so the press hands it up
 * rather than keeping state of its own, and flipping it refetches the way the
 * scope toggle does.
 */
export function WindowSwitcher({
  value,
  onChange,
  windows,
}: {
  value: AdminMetricsWindow;
  onChange: (windowDays: AdminMetricsWindow) => void;
  /** The lengths a screen offers, where it answers fewer than all three. */
  windows?: readonly AdminMetricsWindow[] | undefined;
}): React.JSX.Element {
  const options =
    windows === undefined
      ? WINDOW_OPTIONS
      : WINDOW_OPTIONS.filter((option) => windows.includes(ADMIN_METRICS_WINDOW[option.value]));
  const chosen = options.find((option) => ADMIN_METRICS_WINDOW[option.value] === value);
  return (
    <ChoiceBar
      label="Window in days"
      items={options}
      value={chosen?.value}
      look={CHOICE_BAR_LOOK.SEGMENTED}
      onChange={(name) => onChange(ADMIN_METRICS_WINDOW[name])}
    />
  );
}

export function HideAdminsToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (hide: boolean) => void;
}): React.JSX.Element {
  return (
    <Checkbox checked={checked} onChange={onChange}>
      Hide admins
    </Checkbox>
  );
}
