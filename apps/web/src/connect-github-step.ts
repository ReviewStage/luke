import { CONNECT_GITHUB_PAGE } from "@sidecar/hosted/connect-github-page";

/**
 * connect-github-step.ts -- which step the Connect GitHub page is at, read from the browser's session and the page's own address.
 *
 * The page links GitHub to the Luke account signed in to this browser, so it
 * first needs one; the Mac names the account it expects in `account`, and a
 * browser signed in as another Luke account is told so rather than linking
 * GitHub to an account the Mac is not using. Better Auth returns to the page
 * with `connected` after a link it made and with `error` after one it
 * refused, and those come before anything else the page could say.
 */

export const CONNECT_QUERY = {
  /** The Luke account id the Mac is signed in as. */
  ACCOUNT: CONNECT_GITHUB_PAGE.ACCOUNT_QUERY,
  /** Set on the page Better Auth returns to after linking. */
  CONNECTED: "connected",
  /** Better Auth's own reason, on the page it returns to after refusing. */
  ERROR: "error",
} as const;

export const CONNECT_STEP = {
  SIGN_IN: "sign-in",
  WRONG_ACCOUNT: "wrong-account",
  READY: "ready",
  CONNECTED: "connected",
  FAILED: "failed",
} as const;

export type ConnectStep =
  | { readonly step: typeof CONNECT_STEP.SIGN_IN }
  | { readonly step: typeof CONNECT_STEP.WRONG_ACCOUNT }
  | { readonly step: typeof CONNECT_STEP.READY }
  | { readonly step: typeof CONNECT_STEP.CONNECTED }
  | { readonly step: typeof CONNECT_STEP.FAILED; readonly message: string };

/** Better Auth's refusals a developer can do something about, in the page's words. */
const FAILURE_MESSAGE = new Map([
  [
    "account_already_linked_to_different_user",
    "That GitHub account is already connected to another Luke account.",
  ],
  ["access_denied", "GitHub did not grant access. You can try again."],
]);

const DEFAULT_FAILURE = "GitHub could not be connected. Try again.";

/** The step for this browser's session (its Luke user id, or none) and the page's query. */
export function connectStep(
  sessionUserId: string | undefined,
  query: URLSearchParams,
): ConnectStep {
  const error = query.get(CONNECT_QUERY.ERROR);
  if (error !== null) {
    return { step: CONNECT_STEP.FAILED, message: FAILURE_MESSAGE.get(error) ?? DEFAULT_FAILURE };
  }
  if (sessionUserId === undefined) return { step: CONNECT_STEP.SIGN_IN };
  const expected = query.get(CONNECT_QUERY.ACCOUNT);
  if (expected !== null && expected !== "" && expected !== sessionUserId) {
    return { step: CONNECT_STEP.WRONG_ACCOUNT };
  }
  if (query.get(CONNECT_QUERY.CONNECTED) !== null) return { step: CONNECT_STEP.CONNECTED };
  return { step: CONNECT_STEP.READY };
}

/** The page again with `name` set, keeping the account the Mac named: where Better Auth returns to. */
export function returnAddress(current: URL, name: string): string {
  const back = new URL(current.pathname, current.origin);
  const account = current.searchParams.get(CONNECT_QUERY.ACCOUNT);
  if (account) back.searchParams.set(CONNECT_QUERY.ACCOUNT, account);
  if (name) back.searchParams.set(name, "1");
  return `${back.pathname}${back.search}`;
}
