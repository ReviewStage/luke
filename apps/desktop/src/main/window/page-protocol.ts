import { framedPageOf, PAGE_SCHEME } from "@luke/features/page-frame";
import type { TasksPageAnswer, TasksPageParams } from "@luke/features/tasks-view";
import { Effect } from "effect";
import type { CustomScheme } from "electron";

/**
 * page-protocol.ts -- the `luke-page:` scheme: one version of one plan's page, served to the frame that draws it.
 *
 * A page is HTML an agent wrote, so it is served as nothing of Luke's own: a
 * scheme of its own, read from the service by this process on the account's
 * bearer and answered whole, under a policy that lets the page run its own
 * inline scripts and the libraries cdnjs serves, and reach nothing else. It
 * may fetch, post, or open nothing, embed no frame, submit no form, and load
 * no image or font from anywhere but itself and cdnjs, so a page an agent
 * was talked into writing has no road out with what it holds. The policy's
 * `sandbox` keeps the page sandboxed even outside the frame the panel draws
 * it in, with an opaque origin and no storage, no popups, and no way to move
 * the window. The privileges mark the scheme standard and secure and nothing
 * more: no fetch from another document, no service worker, no CORS.
 */

const CDNJS = "https://cdnjs.cloudflare.com";

/** The policy every page is served under. */
const PAGE_POLICY = [
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

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": PAGE_POLICY,
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
} as const;

/** The scheme as Electron must be told of it before the app is ready. */
export const PAGE_SCHEME_PRIVILEGES: CustomScheme = {
  scheme: PAGE_SCHEME,
  privileges: { standard: true, secure: true },
};

const NOT_FOUND = 404;

/**
 * The answer to one request of the scheme: the version the address names,
 * under the page policy, or not found for an address that names none and a
 * version the service did not answer.
 */
export function pageResponse(
  url: string,
  readPage: (page: TasksPageParams) => Effect.Effect<TasksPageAnswer>,
): Effect.Effect<Response> {
  const framed = framedPageOf(url);
  if (framed === undefined) return Effect.succeed(new Response(null, { status: NOT_FOUND }));
  return Effect.map(readPage(framed), (answer) =>
    "page" in answer
      ? new Response(answer.page.html, { headers: PAGE_HEADERS })
      : new Response(null, { status: NOT_FOUND }),
  );
}
