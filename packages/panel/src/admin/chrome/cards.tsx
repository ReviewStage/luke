import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { ERROR_STATE_PLACEMENT, ErrorState } from "@repo/ui";
import { unreadShown } from "../../failure-report.js";

/**
 * The failed read in the page's place, under the page's own toolbar, so the
 * title and the controls stay where they stood: the app's centered failure,
 * with the Retry every screen offers on it. Note that Retry refuses a press
 * while a read is out, because a second read would abort the first and
 * start the wait over.
 */
export function AdminErrorState({
  detail,
  refreshing,
  onRetry,
}: {
  detail: string;
  refreshing: boolean;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <ErrorState
      failure={unreadShown(FAILURE_SURFACE.ADMIN_READ)}
      placement={ERROR_STATE_PLACEMENT.CENTERED}
      onRetry={() => {
        if (!refreshing) onRetry();
      }}
    >
      {detail}
    </ErrorState>
  );
}
