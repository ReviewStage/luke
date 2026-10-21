import type { DatabaseServices } from "@luke/database/core/query";
import {
  countInlineLineFiles,
  LINE_FILE_BACKFILL,
  moveInlineLineFiles,
} from "@luke/database/models/line-files";
import type { TaskStoreEffect } from "@luke/database/models/task-store";
import { Clock, Effect, type Redacted } from "effect";
import {
  bearerMatchesSecret,
  errorResponse,
  HOSTED_API_ERROR,
  HOSTED_HTTP_STATUS,
  jsonResponse,
} from "../http/http.js";

/**
 * line-files-backfill.ts -- the files developers' lines carried inline, moved beside their conversations a batch at a time, asked by hand.
 *
 * A user row written before the store kept a line's files beside the
 * conversation carries each as a file part over a `data:` URL
 * (`@luke/database/models/line-files`). A POST moves them: batches of
 * `LINE_FILE_BACKFILL.BATCH_ROWS` rows, each its own short transaction, one
 * after another from the lowest row id until a batch finds no more or the
 * call has spent `TIME_BUDGET_MS`, then answers what it moved and what
 * still remains. A GET moves nothing and answers what remains, which is how
 * its progress is watched. Every batch stands on its own, so a call cut
 * short loses nothing, and running it again moves only what is left; a row
 * whose file no conversation's row may hold is left inline and counted as
 * remaining, never retried within the call.
 *
 * It is asked by hand, under the deployment's own `CRON_SECRET`
 * (`scripts/move-inline-attachments.sh`, which asks again until a call
 * moves nothing), so it runs on the deployment against the database the
 * deployment holds. Its answer is counts alone: no account, row, or file is
 * named, and nothing of a file reaches a trace or a counted event.
 */

/** How long one call goes on starting batches, well inside a function's duration. */
const TIME_BUDGET_MS = 20_000;

/** What one call answers: the rows it moved and read, and the rows and parts still inline after it. */
export interface LineFilesBackfill {
  readonly moved: number;
  readonly read: number;
  readonly remainingRows: number;
  readonly remainingParts: number;
}

/** What the endpoint is handed: the request, and the deployment's secret as its environment holds it. */
export interface LineFilesBackfillOptions {
  readonly request: Request;
  readonly cronSecret: Redacted.Redacted | undefined;
}

/** The batches one call runs, each after the last row the one before it read, until none is left or the budget is spent. */
export function moveLineFiles(): TaskStoreEffect<LineFilesBackfill> {
  return Effect.gen(function* () {
    const started = yield* Clock.currentTimeMillis;
    let moved = 0;
    let read = 0;
    let after: string | undefined;
    for (;;) {
      const batch = yield* moveInlineLineFiles(after);
      moved += batch.moved;
      read += batch.read;
      after = batch.last;
      if (batch.read < LINE_FILE_BACKFILL.BATCH_ROWS) break;
      if ((yield* Clock.currentTimeMillis) - started >= TIME_BUDGET_MS) break;
    }
    const remaining = yield* countInlineLineFiles();
    return { moved, read, remainingRows: remaining.rows, remainingParts: remaining.parts };
  });
}

/** The backfill as its endpoint answers it: a POST moves and a GET counts, both under the deployment's secret. */
export const handleLineFilesBackfill = /* @__PURE__ */ Effect.fn("web/handleLineFilesBackfill")(
  function* (
    options: LineFilesBackfillOptions,
  ): Effect.fn.Return<Response, unknown, DatabaseServices> {
    const { request } = options;
    if (request.method !== "POST" && request.method !== "GET") {
      return errorResponse(
        HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
        HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
      );
    }
    if (options.cronSecret === undefined) {
      return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
    }
    if (!bearerMatchesSecret(request, options.cronSecret)) {
      return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
    }
    if (request.method === "GET") {
      const remaining = yield* countInlineLineFiles();
      return jsonResponse(HOSTED_HTTP_STATUS.OK, {
        remainingRows: remaining.rows,
        remainingParts: remaining.parts,
      });
    }
    return jsonResponse(HOSTED_HTTP_STATUS.OK, yield* moveLineFiles());
  },
);
