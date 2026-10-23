import type { AdminDoors } from "./admin-doors.js";
import { AdminErrorState } from "./chrome/cards.js";
import { Refreshing } from "./chrome/controls.js";
import { ADMIN_READ_STATUS, type AdminReadHandle, adminReadFailure } from "./use-admin-read.js";

/**
 * admin-read-view.tsx -- one admin screen drawn from where its read stands: the gate's cards, its skeleton, its failure, or its answer.
 *
 * Every screen meets a read the same way: the gate's own cards where it
 * refused, which stand alone; the page's skeleton while it is read; the
 * page's frame holding the failure where it failed, worded as the screen's
 * own where the endpoint answered none; and the answer, dimmed while a
 * refresh is out and with a refresh's failure over it (`Refreshing`). The
 * page around each is the screen's.
 */

/** How one screen draws each place its read may stand. */
export interface AdminReadArms<T> {
  readonly read: Pick<AdminReadHandle<T>, "state" | "refreshing" | "reload">;
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

/** The screen as its read stands now. */
export function adminReadView<T>(arms: AdminReadArms<T>): React.JSX.Element {
  const { state, refreshing, reload } = arms.read;
  switch (state.status) {
    case ADMIN_READ_STATUS.LOADING:
      return arms.loading();
    case ADMIN_READ_STATUS.SIGNED_OUT:
      return arms.gate.signedOut();
    case ADMIN_READ_STATUS.FORBIDDEN:
      return arms.gate.forbidden({ email: arms.email, onSignOut: arms.onSignOut });
    case ADMIN_READ_STATUS.MISSING:
    case ADMIN_READ_STATUS.ERROR:
      if (state.status === ADMIN_READ_STATUS.MISSING && arms.missing !== undefined) {
        return arms.missing();
      }
      return arms.failed(
        <AdminErrorState
          detail={adminReadFailure(state, arms.failure)}
          refreshing={refreshing}
          onRetry={reload}
        />,
      );
    case ADMIN_READ_STATUS.READY:
      return arms.ready(state.value, (sections) => (
        <Refreshing failure={state.refreshFailure} refreshing={refreshing} onRetry={reload}>
          {sections}
        </Refreshing>
      ));
  }
}
