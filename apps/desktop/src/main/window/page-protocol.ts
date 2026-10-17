import { framedPageOf, PAGE_SCHEME } from "@luke/features/page-frame";
import { PAGE_RESPONSE_HEADERS } from "@luke/features/page-policy";
import type { TasksPageAnswer, TasksPageParams } from "@luke/features/tasks-view";
import { Effect } from "effect";
import type { CustomScheme } from "electron";

/**
 * page-protocol.ts -- the `luke-page:` scheme: one version of one plan's page, served to the frame that draws it.
 *
 * A page is HTML an agent wrote, so it is served as nothing of Luke's own: a
 * scheme of its own, read from the service by this process on the account's
 * bearer and answered whole, under the page policy `@luke/features/page-policy`
 * states for every server of a page. The privileges mark the scheme standard
 * and secure and nothing more: no fetch from another document, no service
 * worker, no CORS.
 */

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
      ? new Response(answer.page.html, { headers: PAGE_RESPONSE_HEADERS })
      : new Response(null, { status: NOT_FOUND }),
  );
}
