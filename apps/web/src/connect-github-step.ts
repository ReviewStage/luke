import { GITHUB_CONNECT_PAGE } from "@sidecar/hosted/github-connection-wire";

/**
 * connect-github-step.ts -- what the connect page was opened to do, read from its address, and Better Auth's refusals in words.
 *
 * The page is opened by the Mac with an intent, by Better Auth returning
 * the browser from GitHub with `done=1` or `error=1` and its own code
 * beside it. An address naming none of those asks nothing.
 */

export const CONNECT_STEP = {
  CONNECT: "connect",
  DONE: "done",
  FAILED: "failed",
  NOTHING: "nothing",
} as const;

export type ConnectStep =
  | { readonly kind: typeof CONNECT_STEP.CONNECT; readonly intent: string }
  | {
      readonly kind: typeof CONNECT_STEP.FAILED;
      readonly code: string | undefined;
      readonly retry: string | undefined;
    }
  | {
      readonly kind: typeof CONNECT_STEP.DONE | typeof CONNECT_STEP.NOTHING;
    };

/** Better Auth's codes for a link it refused, as its OAuth callback names them. */
const LINK_ERROR = {
  ACCOUNT_ALREADY_LINKED: "account_already_linked_to_different_user",
  EMAIL_MISMATCH: "email_doesn't_match",
  UNABLE_TO_LINK: "unable_to_link_account",
} as const;

type LinkError = (typeof LINK_ERROR)[keyof typeof LINK_ERROR];

const LINK_ERROR_WORDS = {
  [LINK_ERROR.ACCOUNT_ALREADY_LINKED]:
    "This GitHub account belongs to another Luke account. Sign in with GitHub instead.",
  [LINK_ERROR.EMAIL_MISMATCH]: "GitHub's email address does not match this Luke account's.",
  [LINK_ERROR.UNABLE_TO_LINK]: "GitHub did not confirm this account, so it was not connected.",
} as const satisfies Record<LinkError, string>;

function isLinkError(code: string): code is LinkError {
  return Object.hasOwn(LINK_ERROR_WORDS, code);
}

/** The connect page's address for an intent, which claims it again and retries the link. */
function intentAddress(intent: string): string {
  const query = new URLSearchParams({ [GITHUB_CONNECT_PAGE.INTENT_PARAM]: intent });
  return `${GITHUB_CONNECT_PAGE.PATH}?${query.toString()}`;
}

/**
 * Where Better Auth sends the browser when GitHub refuses or the developer
 * cancels: the page's `error=1` with the intent beside it, so the failure
 * page can offer the same intent again, since a claim spends nothing.
 */
export function failedLinkAddress(intent: string): string {
  const query = new URLSearchParams({
    [GITHUB_CONNECT_PAGE.ERROR_PARAM]: GITHUB_CONNECT_PAGE.FLAG,
    [GITHUB_CONNECT_PAGE.INTENT_PARAM]: intent,
  });
  return `${GITHUB_CONNECT_PAGE.PATH}?${query.toString()}`;
}

/** What the address asks. Better Auth appends its own `error` code after the page's `error=1`, so the code is the other value. */
export function connectStepFromSearch(search: string): ConnectStep {
  const query = new URLSearchParams(search);
  const errors = query.getAll(GITHUB_CONNECT_PAGE.ERROR_PARAM);
  if (errors.length > 0) {
    const intent = query.get(GITHUB_CONNECT_PAGE.INTENT_PARAM);
    return {
      kind: CONNECT_STEP.FAILED,
      code: errors.find((e) => e !== GITHUB_CONNECT_PAGE.FLAG),
      retry: intent ? intentAddress(intent) : undefined,
    };
  }
  if (query.get(GITHUB_CONNECT_PAGE.DONE_PARAM) === GITHUB_CONNECT_PAGE.FLAG) {
    return { kind: CONNECT_STEP.DONE };
  }
  const intent = query.get(GITHUB_CONNECT_PAGE.INTENT_PARAM);
  if (intent) return { kind: CONNECT_STEP.CONNECT, intent };
  return { kind: CONNECT_STEP.NOTHING };
}

/** What failed, as the first words of a refusal Luke has no words of its own for. */
export const LINK_FAILED = {
  CONNECT: "GitHub could not be connected",
} as const;

type LinkFailed = (typeof LINK_FAILED)[keyof typeof LINK_FAILED];

/** A refusal in words: ours for the codes Luke expects, Better Auth's own message or code for any other. */
export function linkErrorWords(
  failed: LinkFailed,
  code: string | undefined,
  message?: string,
): string {
  if (code !== undefined && isLinkError(code)) return LINK_ERROR_WORDS[code];
  const said = message ?? code;
  return said ? `${failed}: ${said}` : `${failed}.`;
}
