import type { DatabaseServices } from "@luke/database/core/query";
import {
  listEveryGitHubTokenRow,
  rewrapGitHubTokenRow,
} from "@luke/database/models/github-token-store";
import {
  type KeyRing,
  parseKeyRing,
  rewrapGitHubToken,
  rewrapProviderKey,
} from "@luke/database/models/provider-key-seal";
import {
  listEveryProviderKeyRow,
  rewrapProviderKeyRow,
} from "@luke/database/models/provider-key-store";
import type { TaskStoreEffect } from "@luke/database/models/task-store";
import { Effect, type Redacted, Result } from "effect";
import {
  bearerMatchesSecret,
  errorResponse,
  HOSTED_API_ERROR,
  HOSTED_HTTP_STATUS,
  jsonResponse,
} from "../http/http.js";

/**
 * provider-key-rewrap.ts -- every stored provider key and GitHub token moved onto the ring's current key-encryption key.
 *
 * The rotation's one step after a new version heads the environment's list:
 * each row wrapped under an older version has its data key unwrapped and
 * wrapped again under the current one, its sealed provider key untouched,
 * so no provider key is ever in the clear for it. A row is moved only where
 * it still holds the seal it was read with, so a key saved meanwhile keeps
 * its own; a row whose wrap does not open is left as it is and counted, and
 * reads unreadable to its account until it is replaced. Running it twice
 * moves nothing the second time. Members' GitHub tokens are sealed under
 * the same ring, so the same pass moves them too, counted with the keys.
 *
 * It is asked by hand, `POST /api/maintenance/provider-keys-rewrap` under the
 * deployment's own `CRON_SECRET` (`scripts/rewrap-provider-keys.sh`), so it
 * runs on the deployment with the ring the deployment holds: the
 * key-encryption keys never leave the environment they were set in.
 */

/** What one pass did, in counts alone: no account and no key is named. */
export interface ProviderKeyRewrap {
  /** Rows moved onto the current version. */
  readonly moved: number;
  /** Rows already on it. */
  readonly current: number;
  /** Rows replaced or moved by someone else between the read and the write. */
  readonly changed: number;
  /** Rows whose wrap the ring cannot open. */
  readonly unreadable: number;
}

/** What the endpoint is handed: the request, and the deployment's secret and ring as its environment holds them. */
export interface ProviderKeyRewrapOptions {
  readonly request: Request;
  readonly cronSecret: Redacted.Redacted | undefined;
  readonly keys: Redacted.Redacted | undefined;
}

/** One pass over every stored provider key and GitHub token. */
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

/** The rewrap as its endpoint answers it: a POST under the deployment's secret, answered with the pass's counts and the version they moved onto. */
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
