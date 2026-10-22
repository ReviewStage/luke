/**
 * page-policy.ts -- the response policy a plan's page is served under, wherever it is served from.
 *
 * A page is HTML an agent wrote, so it is served as nothing of Luke's own,
 * under a policy that lets the page run its own inline scripts and the
 * libraries cdnjs serves. Under it the page may fetch or post nothing, embed
 * no frame, submit no form, and load no image or font from anywhere but
 * itself and cdnjs. The policy's `sandbox` keeps the page sandboxed even
 * outside the frame that draws it, with an opaque origin and no storage, no
 * popups, and no way to move the window. Every server of a page answers with
 * these headers, so the policy is stated once.
 *
 * Note that this policy alone is not a sealed room. A script the sandbox
 * allows can still navigate its own frame to an outside address carrying
 * what it holds in the URL, which nothing here refuses; WebRTC and DNS
 * prefetch fall outside CSP altogether. What refuses the navigation is the
 * policy of the page that frames it: the web app's own `frame-src 'self'`
 * (the root `vercel.json`) and the desktop panel's `frame-src luke-page:`
 * (`apps/desktop/src/renderer/index.html`), which a frame's navigation to
 * any other origin is held to. A page opened alone, outside that frame, has
 * neither.
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
