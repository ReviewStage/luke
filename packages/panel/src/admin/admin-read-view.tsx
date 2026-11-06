import { ADMIN_REFUSED } from "@repo/features/admin-wire";
import type { UseQueryResult } from "@tanstack/react-query";
import { type AdminDoors, AdminReadRefused } from "./admin-doors.js";
import { AdminErrorState } from "./chrome/cards.js";
import { Refreshing } from "./chrome/controls.js";

const ADMIN_READ_ERROR = {
  UNAVAILABLE: "The service did not answer.",
  PROTECTED:
    "The request was redirected before it reached the dashboard. A preview deployment behind Vercel Deployment Protection intercepts the API call; disable protection for this deployment, or use a production URL.",
} as const;

export interface AdminReadArms<T> {
  readonly read: Pick<UseQueryResult<T>, "data" | "error" | "isFetching" | "refetch">;
  readonly gate: AdminDoors["gate"];
  readonly email: string | undefined;
  readonly onSignOut: () => void;
  readonly failure: string;
  readonly loading: () => React.JSX.Element;
  readonly failed: (error: React.JSX.Element) => React.JSX.Element;
  readonly missing?: (() => React.JSX.Element) | undefined;
  readonly ready: (
    value: T,
    refreshed: (sections: React.ReactNode) => React.JSX.Element,
  ) => React.JSX.Element;
}

function failureWords(error: Error, endpointDetail: string): string {
  if (!(error instanceof AdminReadRefused)) return endpointDetail;
  if (error.refused === ADMIN_REFUSED.UNAVAILABLE) return ADMIN_READ_ERROR.UNAVAILABLE;
  if (error.refused === ADMIN_REFUSED.INTERCEPTED) return ADMIN_READ_ERROR.PROTECTED;
  return endpointDetail;
}

export function adminReadView<T>(arms: AdminReadArms<T>): React.JSX.Element {
  const { data, error, isFetching, refetch } = arms.read;
  const reload = () => void refetch();
  if (arms.gate.heldAtGate()) return arms.gate.signedOut();
  const refused = error instanceof AdminReadRefused ? error.refused : undefined;
  if (refused === ADMIN_REFUSED.SIGNED_OUT) return arms.gate.signedOut();
  if (refused === ADMIN_REFUSED.FORBIDDEN) {
    return arms.gate.forbidden({ email: arms.email, onSignOut: arms.onSignOut });
  }
  if (refused === ADMIN_REFUSED.MISSING && arms.missing !== undefined) return arms.missing();
  if (error !== null && (data === undefined || refused === ADMIN_REFUSED.MISSING)) {
    return arms.failed(
      <AdminErrorState
        detail={failureWords(error, arms.failure)}
        refreshing={isFetching}
        onRetry={reload}
      />,
    );
  }
  if (data === undefined) return arms.loading();
  const refreshFailure = error === null ? undefined : failureWords(error, arms.failure);
  return arms.ready(data, (sections) => (
    <Refreshing failure={refreshFailure} refreshing={isFetching} onRetry={reload}>
      {sections}
    </Refreshing>
  ));
}
