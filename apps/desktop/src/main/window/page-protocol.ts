import {
  isMcpAppFrameUrl,
  MCP_APP_FRAME_HEADERS,
  MCP_APP_FRAME_HTML,
} from "@luke/features/mcp-app-frame";
import { withPageFind } from "@luke/features/page-find";
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
 * states for every server of a page, with the find's script ahead of it
 * (`@luke/features/page-find`), which ⌘F in the panel finds through. Beside
 * the pages it serves the one document an integration tool's MCP App is
 * drawn inside (`@luke/features/mcp-app-frame`), under that document's own
 * policy, at the one address it names. The
 * privileges mark the scheme standard and secure and nothing more: no fetch
 * from another document, no service worker, no CORS.
 */

/** The scheme as Electron must be told of it before the app is ready. */
export const PAGE_SCHEME_PRIVILEGES: CustomScheme = {
  scheme: PAGE_SCHEME,
  privileges: { standard: true, secure: true },
};

const NOT_FOUND = 404;

/**
 * The answer to one request of the scheme: the MCP App frame's document at
 * its address, the version the address names under the page policy, or not
 * found for an address that names neither and a version the service did not
 * answer.
 */
export function pageResponse(
  url: string,
  readPage: (page: TasksPageParams) => Effect.Effect<TasksPageAnswer>,
): Effect.Effect<Response> {
  if (isMcpAppFrameUrl(url)) {
    return Effect.succeed(new Response(MCP_APP_FRAME_HTML, { headers: MCP_APP_FRAME_HEADERS }));
  }
  const framed = framedPageOf(url);
  if (framed === undefined) return Effect.succeed(new Response(null, { status: NOT_FOUND }));
  return Effect.map(readPage(framed), (answer) =>
    "page" in answer
      ? new Response(withPageFind(answer.page.html), { headers: PAGE_RESPONSE_HEADERS })
      : new Response(null, { status: NOT_FOUND }),
  );
}
