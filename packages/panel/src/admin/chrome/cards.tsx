import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { ERROR_STATE_PLACEMENT, ErrorState } from "@repo/ui";
import { unreadShown } from "../../failure-report.js";

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
