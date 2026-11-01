/**
 * account.ts -- the account every shot is signed in as: Dean Stratakos, with his GitHub photo.
 *
 * Throwaway (`README.md`). A fixture run signs in to nothing, so the
 * sidebar's foot would read "Not signed in"; the shots draw this account in
 * its place, and every surface gated on a signed-in account draws as signed in.
 */

import { ACCOUNT_STATUS, type AccountSnapshot } from "@luke/credentials/snapshot";
import { DEAN_AVATAR_DATA_URL } from "./dean-avatar";

/** The account, built once, so a render reads the same object each time. */
let held: AccountSnapshot | undefined;

export function shotAccount(): AccountSnapshot {
  held ??= {
    status: ACCOUNT_STATUS.SIGNED_IN,
    name: "Dean Stratakos",
    email: "dean@example.com",
    provider: "github",
    pictureUrl: DEAN_AVATAR_DATA_URL,
  };
  return held;
}
