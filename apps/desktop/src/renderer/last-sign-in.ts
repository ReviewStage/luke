/**
 * last-sign-in.ts -- which provider this Mac last signed in with, kept past sign-out for the gate's "Last used" chip.
 *
 * The gate marks the way in the developer took last, as a devtool's sign-in
 * does, so it is kept in the renderer's own storage rather than on the
 * account: it has to outlive the account's leaving, which is the moment it is
 * read. Only the provider's name is kept, never anything about the account.
 * It is written whenever the account reads signed in, so a sign-in begun from
 * anywhere counts and an attempt that never lands changes nothing. A fixture
 * run reads and keeps nothing, so its frames never wear a developer's history.
 */

import {
  ACCOUNT_PROVIDER,
  ACCOUNT_STATUS,
  type AccountProvider,
  type AccountSnapshot,
} from "@luke/credentials/snapshot";
import { Option, Schema } from "effect";
import { useEffect, useState } from "react";

/** Where the provider is kept in the renderer's storage. */
const STORAGE_KEY = "luke.lastSignInProvider";

/** The provider as kept: its own name, nothing more. */
const storedProvider = Schema.Literals(Object.values(ACCOUNT_PROVIDER));

/** The kept provider, or none where none was kept, it no longer reads, or storage refuses the read. */
function readKept(): AccountProvider | undefined {
  try {
    const decoded = Schema.decodeUnknownOption(storedProvider)(
      window.localStorage.getItem(STORAGE_KEY),
    );
    return Option.getOrUndefined(decoded);
  } catch {
    return undefined;
  }
}

/** Keeps the provider; a write that fails costs only the chip, so it is not worth a word. */
function writeKept(provider: AccountProvider): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, provider);
  } catch {
    // The gate offers its default emphasis instead.
  }
}

/** The provider this Mac last signed in with, kept as the account signs in, unless the run is `staged`. */
export function useLastSignIn(
  account: AccountSnapshot | undefined,
  staged: boolean,
): AccountProvider | undefined {
  const [kept, setKept] = useState(readKept);
  const signedIn = account?.status === ACCOUNT_STATUS.SIGNED_IN ? account.provider : undefined;
  useEffect(() => {
    if (staged || signedIn === undefined) return;
    writeKept(signedIn);
    setKept(signedIn);
  }, [signedIn, staged]);
  return staged ? undefined : kept;
}
