/**
 * window-account.ts -- the account the window holds what it opened under: its terminals and its cloud Browser tabs, read and written as that account's alone.
 *
 * The window's root hands down the account signed in (`app.tsx`), none for
 * no account, so a door names the account it reads or writes under rather
 * than a holder remembering whose it reads, and a draw on the very render an
 * account changes reads the new one's.
 */

import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { createContext, useContext } from "react";

/** The key the window holds what it opens under for the account main's document names: its id, or its address where it has none; none while no account is signed in. */
export function windowAccountOf(
  account: AppStateSnapshot["account"] | undefined,
): string | undefined {
  return account?.status === ACCOUNT_STATUS.SIGNED_IN ? (account.id ?? account.email) : undefined;
}

/** The account signed in, by its key, none for no account; the root's own unless a provider above hands another. */
export const WindowAccountContext = createContext<string | undefined>(undefined);

/** The account the window holds what it opens under. */
export function useWindowAccount(): string | undefined {
  return useContext(WindowAccountContext);
}
