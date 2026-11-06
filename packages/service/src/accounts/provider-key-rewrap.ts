import type { DatabaseServices } from "@repo/database/core/query";
import {
  listEveryGitHubTokenRow,
  rewrapGitHubTokenRow,
} from "@repo/database/models/github-token-store";
import {
  type KeyRing,
  parseKeyRing,
  rewrapGitHubToken,
  rewrapProviderKey,
} from "@repo/database/models/provider-key-seal";
import {
  listEveryProviderKeyRow,
  rewrapProviderKeyRow,
} from "@repo/database/models/provider-key-store";
import type { TaskStoreEffect } from "@repo/database/models/task-store";
import { Effect, type Redacted, Result } from "effect";
import {
  bearerMatchesSecret,
  errorResponse,
  HOSTED_API_ERROR,
  HOSTED_HTTP_STATUS,
  jsonResponse,
} from "../http/http.js";

export interface ProviderKeyRewrap {
  readonly moved: number;
  readonly current: number;
  readonly changed: number;
  readonly unreadable: number;
}

export interface ProviderKeyRewrapOptions {
  readonly request: Request;
  readonly cronSecret: Redacted.Redacted | undefined;
  readonly keys: Redacted.Redacted | undefined;
}

export function rewrapProviderKeys(ring: KeyRing): TaskStoreEffect<ProviderKeyRewrap> {
  return Effect.gen(function* () {
    const counts = { moved: 0, current: 0, changed: 0, unreadable: 0 };
    for (const row of yield* listEveryProviderKeyRow()) {
      if (row.keyVersion === ring.current) {
        counts.current += 1;
        continue;
      }
      const rewrapped = rewrapProviderKey(ring, row, row);
      if (Result.isFailure(rewrapped)) {
        counts.unreadable += 1;
        continue;
      }
      if (yield* rewrapProviderKeyRow(row, rewrapped.success)) counts.moved += 1;
      else counts.changed += 1;
    }
    for (const row of yield* listEveryGitHubTokenRow()) {
      if (row.keyVersion === ring.current) {
        counts.current += 1;
        continue;
      }
      const rewrapped = rewrapGitHubToken(ring, row.userId, row);
      if (Result.isFailure(rewrapped)) {
        counts.unreadable += 1;
        continue;
      }
      if (yield* rewrapGitHubTokenRow(row, rewrapped.success)) counts.moved += 1;
      else counts.changed += 1;
    }
    return counts;
  });
}

export const handleProviderKeyRewrap = /* @__PURE__ */ Effect.fn("web/handleProviderKeyRewrap")(
  function* (
    options: ProviderKeyRewrapOptions,
  ): Effect.fn.Return<Response, unknown, DatabaseServices> {
    const { request } = options;
    if (request.method !== "POST") {
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
    const ring = options.keys === undefined ? undefined : parseKeyRing(options.keys);
    if (ring === undefined || Result.isFailure(ring)) {
      return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
    }
    const counts = yield* rewrapProviderKeys(ring.success);
    return jsonResponse(HOSTED_HTTP_STATUS.OK, { version: ring.success.current, ...counts });
  },
);
