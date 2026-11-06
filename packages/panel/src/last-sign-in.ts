import {
  ACCOUNT_PROVIDER,
  ACCOUNT_STATUS,
  type AccountProvider,
  type AccountSnapshot,
} from "@repo/credentials/snapshot";
import { Option, Schema } from "effect";
import { useEffect, useState } from "react";
import { readKeptOption, writeKept } from "./kept-storage.js";

const STORAGE_KEY = "app.lastSignInProvider";

const storedProvider = Schema.Literals(Object.values(ACCOUNT_PROVIDER));

function readProvider(): AccountProvider | undefined {
  return Option.getOrUndefined(readKeptOption(STORAGE_KEY, storedProvider));
}

export function useLastSignIn(
  account: AccountSnapshot | undefined,
  staged: boolean,
): AccountProvider | undefined {
  const [kept, setKept] = useState(readProvider);
  const signedIn = account?.status === ACCOUNT_STATUS.SIGNED_IN ? account.provider : undefined;
  useEffect(() => {
    if (staged || signedIn === undefined) return;
    writeKept(STORAGE_KEY, storedProvider, signedIn);
    setKept(signedIn);
  }, [signedIn, staged]);
  return staged ? undefined : kept;
}
