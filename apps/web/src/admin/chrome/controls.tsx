import { ADMIN_METRICS_WINDOW, type AdminMetricsWindow } from "@luke/service/admin/http";
import { CARD_PADDING, Card } from "@luke/ui";

const REFRESH_FAILED = "Refresh failed.";

const STILL_SHOWING = "Still showing the earlier answer.";

/** The page's one button treatment: sign out and try again both wear it. */
export const PLAIN_BUTTON =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium transition-colors duration-150 hover:bg-muted disabled:cursor-default disabled:opacity-60 disabled:hover:bg-card";

/**
 * The failure a refresh landed on an answer that stays shown: the numbers on
 * screen are still the last ones actually read, and this band says the newer
 * read did not arrive. The status region stands in the page whether or not
 * it has anything to say, because a live region inserted together with its
 * news is announced by nothing; so it stands outside the band, which comes
 * and goes, and says the failure to a reader while the band draws the same
 * words for the eye. It holds the announcement alone, so a press flipping
 * the button's label cannot re-announce the failure and the button keeps
 * its own role.
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
    <div className={failure !== undefined ? "mt-6" : undefined}>
      <span role="status" className="sr-only">
        {failure !== undefined ? `${REFRESH_FAILED} ${STILL_SHOWING} ${failure}` : null}
      </span>
      {failure !== undefined ? (
        <Card padding={CARD_PADDING.SNUG}>
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm">
            <span aria-hidden="true">
              <span className="font-medium text-attention">{REFRESH_FAILED}</span>{" "}
              <span className="text-muted-foreground">
                {STILL_SHOWING} {failure}
              </span>
            </span>
            <button type="button" className={PLAIN_BUTTON} onClick={onRetry} disabled={refreshing}>
              {refreshing ? "Trying…" : "Try again"}
            </button>
          </div>
        </Card>
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
