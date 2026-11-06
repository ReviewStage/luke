import { GITHUB_CONNECT_PAGE } from "./github-connection-wire.js";
import { PRODUCT_NAME } from "./product-name.js";

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

const LINK_ERROR = {
  ACCOUNT_ALREADY_LINKED: "account_already_linked_to_different_user",
  EMAIL_MISMATCH: "email_doesn't_match",
  UNABLE_TO_LINK: "unable_to_link_account",
} as const;

type LinkError = (typeof LINK_ERROR)[keyof typeof LINK_ERROR];

const LINK_ERROR_WORDS = {
  [LINK_ERROR.ACCOUNT_ALREADY_LINKED]: `This GitHub account belongs to another ${PRODUCT_NAME} account. Sign in with GitHub instead.`,
  [LINK_ERROR.EMAIL_MISMATCH]: `GitHub's email address does not match this ${PRODUCT_NAME} account's.`,
  [LINK_ERROR.UNABLE_TO_LINK]: "GitHub did not confirm this account, so it was not connected.",
} as const satisfies Record<LinkError, string>;

function isLinkError(code: string): code is LinkError {
  return Object.hasOwn(LINK_ERROR_WORDS, code);
}

function intentAddress(intent: string): string {
  const query = new URLSearchParams({ [GITHUB_CONNECT_PAGE.INTENT_PARAM]: intent });
  return `${GITHUB_CONNECT_PAGE.PATH}?${query.toString()}`;
}

export function failedLinkAddress(intent: string): string {
  const query = new URLSearchParams({
    [GITHUB_CONNECT_PAGE.ERROR_PARAM]: GITHUB_CONNECT_PAGE.FLAG,
    [GITHUB_CONNECT_PAGE.INTENT_PARAM]: intent,
  });
  return `${GITHUB_CONNECT_PAGE.PATH}?${query.toString()}`;
}

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

export const LINK_FAILED = {
  CONNECT: "GitHub could not be connected",
} as const;

type LinkFailed = (typeof LINK_FAILED)[keyof typeof LINK_FAILED];

export function linkErrorWords(
  failed: LinkFailed,
  code: string | undefined,
  message?: string,
): string {
  if (code !== undefined && isLinkError(code)) return LINK_ERROR_WORDS[code];
  const said = message ?? code;
  return said ? `${failed}: ${said}` : `${failed}.`;
}
