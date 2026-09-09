import { ADMIN_METRICS_WINDOW, type AdminMetricsWindow } from "../../../server/admin/http";

/** The page's one button treatment: sign out and try again both wear it. */
export const PLAIN_BUTTON =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium transition-colors duration-150 hover:bg-muted disabled:cursor-default disabled:opacity-60 disabled:hover:bg-card";

/**
 * The failure a refresh landed on an answer that stays shown: the numbers on
 * screen are still the last ones actually read, and this band says the newer
 * read did not arrive. The
 * status region stands in the page whether or not it has anything to say,
 * because a live region inserted together with its news is announced by
 * nothing; it holds the announcement alone, with the button beside it, so a
 * press flipping the button's label cannot re-announce the failure and the
 * button keeps its own role.
 */
export function RefreshFailureNotice({
  failure,
  refreshing,
  onRetry,
}: {
  failure: string | undefined;
  refreshing: boolean;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <div
      className={
        failure !== undefined
          ? "mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-lg border border-border bg-card px-5 py-3 text-sm"
          : undefined
      }
    >
      <span role="status">
        {failure !== undefined ? (
          <>
            <span className="font-medium text-attention">Refresh failed.</span>{" "}
            <span className="text-muted-foreground">
              Still showing the earlier answer. {failure}
            </span>
          </>
        ) : null}
      </span>
      {failure !== undefined ? (
        <button type="button" className={PLAIN_BUTTON} onClick={onRetry} disabled={refreshing}>
          {refreshing ? "Trying…" : "Try again"}
        </button>
      ) : null}
    </div>
  );
}

/**
 * The window every windowed read answers to, as one control of three fixed
 * lengths. The choice lives in the address bar, so the press hands it up
 * rather than keeping state of its own, and flipping it refetches the way the
 * scope toggle does.
 */
export function WindowSwitcher({
  value,
  onChange,
}: {
  value: AdminMetricsWindow;
  onChange: (windowDays: AdminMetricsWindow) => void;
}): React.JSX.Element {
  return (
    <div className="inline-flex h-8 rounded-md border border-border bg-card p-0.5">
      {Object.values(ADMIN_METRICS_WINDOW).map((windowDays) => (
        <button
          key={windowDays}
          type="button"
          aria-label={`${windowDays}-day window`}
          aria-pressed={value === windowDays}
          data-active={value === windowDays}
          className="cursor-pointer rounded px-2.5 text-xs font-medium text-muted-foreground transition-colors duration-150 outline-offset-2 hover:text-foreground data-[active=true]:bg-muted data-[active=true]:text-foreground"
          onClick={() => onChange(windowDays)}
        >
          {windowDays}d
        </button>
      ))}
    </div>
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
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground select-none">
      <input
        type="checkbox"
        className="size-4 cursor-pointer accent-primary"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      Hide admins
    </label>
  );
}
