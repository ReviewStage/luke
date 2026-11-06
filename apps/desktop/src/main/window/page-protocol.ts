import { withPageScripts } from "@repo/features/page-find";
import { framedPageOf, PAGE_SCHEME } from "@repo/features/page-frame";
import { PAGE_RESPONSE_HEADERS } from "@repo/features/page-policy";
import type { TasksPageAnswer, TasksPageParams } from "@repo/features/tasks-view";
import { Effect } from "effect";
import type { CustomScheme } from "electron";

export const PAGE_SCHEME_PRIVILEGES: CustomScheme = {
  scheme: PAGE_SCHEME,
  privileges: { standard: true, secure: true },
};

const NOT_FOUND = 404;

export function pageResponse(
  url: string,
  readPage: (page: TasksPageParams) => Effect.Effect<TasksPageAnswer>,
): Effect.Effect<Response> {
  const framed = framedPageOf(url);
  if (framed === undefined) return Effect.succeed(new Response(null, { status: NOT_FOUND }));
  return Effect.map(readPage(framed), (answer) =>
    "page" in answer
      ? new Response(withPageScripts(answer.page.html), { headers: PAGE_RESPONSE_HEADERS })
      : new Response(null, { status: NOT_FOUND }),
  );
}
