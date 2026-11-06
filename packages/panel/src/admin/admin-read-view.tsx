import { ADMIN_REFUSED } from "@repo/features/admin-wire";
import type { UseQueryResult } from "@tanstack/react-query";
import { type AdminDoors, AdminReadRefused } from "./admin-doors.js";
import { AdminErrorState } from "./chrome/cards.js";
import { Refreshing } from "./chrome/controls.js";

/**
 * admin-read-view.tsx -- one admin screen drawn from where its query stands: the gate's cards, its skeleton, its failure, or its answer.
 *
 * Every screen meets a read the same way: the gate's own cards where it
 * refused, which stand alone, and never behind an answer, because stale
 * numbers must not stand in front of a withdrawn session or a refused role;
 * the page's skeleton while it is read; the page's frame holding the
 * failure where it failed, worded as the screen's own where the endpoint
 * answered none; and the answer, dimmed while a refresh is out. A refresh
 * that failed keeps the answer up, as Query keeps `data` beside `error`,
 * and says the failure over it (`Refreshing`): it says the network or the
 * service faltered, not that the numbers stopped being true. A gone subject
 * (`MISSING`) replaces the answer like the gate's refusals. The page around
 * each is the screen's.
 */

/** The detail every failed read that is not the endpoint's own carries. */
const ADMIN_READ_ERROR = {
  UNAVAILABLE: "The service did not answer.",
  PROTECTED:
    "The request was redirected before it reached the dashboard. A preview deployment behind Vercel Deployment Protection intercepts the API call; disable protection for this deployment, or use a production URL.",
} as const;

/** How one screen draws each place its read may stand. */
export interface AdminReadArms<T> {
  readonly read: Pick<UseQueryResult<T>, "data" | "error" | "isFetching" | "refetch">;
  readonly gate: AdminDoors["gate"];
  /** Who is signed in, which a refusal names. */
  readonly email: string | undefined;
  readonly onSignOut: () => void;
  /** What a failure says where the endpoint said nothing of its own. */
  readonly failure: string;
  readonly loading: () => React.JSX.Element;
  /** The page holding its failure, `error`. */
  readonly failed: (error: React.JSX.Element) => React.JSX.Element;
  /** The page where its subject is gone; a failure like any other where absent. */
  readonly missing?: (() => React.JSX.Element) | undefined;
  /** The page holding the answer, its sections handed to `refreshed`, which dims them while a refresh is out. */
  readonly ready: (
    value: T,
    refreshed: (sections: React.ReactNode) => React.JSX.Element,
  ) => React.JSX.Element;
}

/**
 * What a failed read says: the service's absence or an interception in
 * their own words, and anything else — a dropped network, an answer that
 * did not read, a 404 from an endpoint that documents none — as the
 * endpoint's own failure.
 */
function failureWords(error: Error, endpointDetail: string): string {
  if (!(error instanceof AdminReadRefused)) return endpointDetail;
  if (error.refused === ADMIN_REFUSED.UNAVAILABLE) return ADMIN_READ_ERROR.UNAVAILABLE;
  if (error.refused === ADMIN_REFUSED.INTERCEPTED) return ADMIN_READ_ERROR.PROTECTED;
  return endpointDetail;
}

/** The screen as its read stands now. */
export function adminReadView<T>(arms: AdminReadArms<T>): React.JSX.Element {
  const { data, error, isFetching, refetch } = arms.read;
  const reload = () => void refetch();
  // A mount may hold every read at its gate, as the web page does until a
  // sign-in has been pressed on it once: the sign-in is then the answer.
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
