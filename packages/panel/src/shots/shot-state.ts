/**
 * shot-state.ts -- what main would hold for a changelog shot: the account signed in, the update, the Inbox, and the tasks, staged over a fixture run's snapshot at the one place a window adopts it.
 *
 * Throwaway (`README.md`). 0.19.0 reads the snapshot in slices, so the shot
 * stages the snapshot itself rather than each reader of it.
 */

import type { AppStateSnapshot } from "@luke/host/app-state";
import { UPDATE_STATUS, type UpdateSnapshot } from "@luke/settings/update";
import { shotAccount } from "./account";
import { shotSpec } from "./shot-profiles";

/** The snapshot as a shot stages it; a run with no shot is handed back as it came. */
export function shotSnapshot(state: AppStateSnapshot): AppStateSnapshot {
  const shot = shotSpec(state.run);
  if (shot === undefined) return state;
  return {
    ...state,
    account: shotAccount(),
    tasks: shot.planning,
    inbox:
      shot.inbox === undefined
        ? state.inbox
        : { ...state.inbox, waiting: shot.inbox.waiting, tasks: shot.inbox.plans },
  };
}

/** The update a shot draws: none to install, so no Update pill; a run with no shot keeps the fixture's. */
export function shotUpdateFor(
  run: { readonly fixtureMode: boolean; readonly profile: string },
  update: UpdateSnapshot,
): UpdateSnapshot {
  if (shotSpec(run) === undefined) return update;
  return {
    status: UPDATE_STATUS.IDLE,
    currentVersion: update.currentVersion,
    installSupported: true,
    upToDate: true,
  };
}
