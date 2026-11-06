export const PLACEHOLDER_GUARD_RULE = "anti-slop/no-placeholder-ellipsis";

export const PLACEHOLDER_NAME = "placeholder";

export const TRAILING_ELLIPSIS = /[\p{L}\p{N} ](?:…|\.\.\.)$/u;

const QUOTED_TRAILING_ELLIPSIS =
  /[\p{L}\p{N} ](?:…|\.\.\.|\\u2026|\\u\{2026\}|&hellip;|&#8230;|&#x2026;)["'`]/iu;

export function namesEllipsisPlaceholder(text: string): boolean {
  return text.includes(PLACEHOLDER_NAME) && QUOTED_TRAILING_ELLIPSIS.test(text);
}
