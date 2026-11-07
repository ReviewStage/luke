/**
 * window-account.ts -- the account the window holds what it opened under: its terminals and its cloud Browser tabs, read and written as that account's alone.
 *
 * The window's root hands down the account signed in (`app.tsx`), none for
 * no account, so a door names the account it reads or writes under rather
 * than a holder remembering whose it reads, and a draw on the very render an
 * account changes reads the new one's.
 */

import { createContext, useContext } from "react";

/** The account signed in, by its key, none for no account; the root's own unless a provider above hands another. */
export const WindowAccountContext = createContext<string | undefined>(undefined);

/** The account the window holds what it opens under. */
export function useWindowAccount(): string | undefined {
  return useContext(WindowAccountContext);
}
