/**
 * redact-credentials.ts -- free text as it may leave the service: every credential-shaped run replaced, the rest word for word.
 *
 * eve's failure message on a turn's row and an error report's words both pass
 * through here, so the two say the same of a key that reached them.
 */

/**
 * The value a `key`, `token`, or `secret` name is assigned by `=` or `:` in a
 * query string or JSON, with up to 64 word characters of whatever prefixes
 * the name; a value ends at a space, an `&`, or a quote, so the parameter
 * after it is still read. Note that the prefix is bounded, because static
 * analysis reads an unbounded `\w*` before the name as rescanned from every
 * offset of a long word run; what a longer prefix leaves is the bare run's.
 */
const NAMED_CREDENTIAL_PATTERN = /\w{0,64}(?:key|token|secret)"?\s*[=:]\s*"?[^\s&"']+/gi;

/**
 * Anything else shaped like a credential, each replaced whole: an `sk-` key,
 * a bearer token, a JWT from its header onward, an AWS access key id, and a
 * run of 32 or more hex or base64 characters, url-safe alphabet included.
 */
const CREDENTIAL_PATTERN =
  /sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+|eyJ[A-Za-z0-9_.-]{16,}|(?:AKIA|ASIA)[0-9A-Z]{16}|[A-Za-z0-9+/=_-]{32,}/gi;

const REDACTED = "[redacted]";

/**
 * Free text as a row or an error report may keep it: every credential-shaped run
 * replaced, the rest word for word. Note that the named values go first, in
 * a pass of their own, because the bare run starting earlier in a long name
 * would otherwise take a value's head up to its first `.` and leave the tail.
 */
export function redactCredentials(message: string): string {
  return message.replace(NAMED_CREDENTIAL_PATTERN, REDACTED).replace(CREDENTIAL_PATTERN, REDACTED);
}
