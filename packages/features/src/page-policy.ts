/**
 * page-policy.ts -- the response policy a plan's page is served under, wherever it is served from.
 *
 * A page is HTML an agent wrote, so it is served as nothing of Luke's own,
 * under a policy that lets the page run its own inline scripts and the
 * libraries cdnjs serves, and reach nothing else. It may fetch, post, or open
 * nothing, embed no frame, submit no form, and load no image or font from
 * anywhere but itself and cdnjs, so a page an agent was talked into writing
 * has no road out with what it holds. The policy's `sandbox` keeps the page
 * sandboxed even outside the frame that draws it, with an opaque origin and
 * no storage, no popups, and no way to move the window. Every server of a
 * page answers with these headers, so the policy is stated once.
 */

const CDNJS = "https://cdnjs.cloudflare.com";

/** The content security policy every page is served under. */
const PAGE_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  `script-src 'unsafe-inline' 'unsafe-eval' ${CDNJS}`,
  `style-src 'unsafe-inline' ${CDNJS}`,
  "img-src data: blob:",
  `font-src data: ${CDNJS}`,
  "media-src data: blob:",
  "worker-src blob:",
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "sandbox allow-scripts",
].join("; ");

/** The headers every page is answered with. */
export const PAGE_RESPONSE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": PAGE_CONTENT_SECURITY_POLICY,
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
} as const;
