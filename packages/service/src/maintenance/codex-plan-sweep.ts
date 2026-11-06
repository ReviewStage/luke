import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { parseKeyRing } from "@repo/database/models/provider-key-seal";
import {
  countStandingFirewalls,
  listStandingFirewalls,
} from "@repo/database/models/sandbox-firewall-store";
import { Effect, type Redacted, Result } from "effect";
import type { HttpClient } from "effect/http";
import { PLAN_RENEWAL, renewPlanSwap } from "../agents/coder-host/codex-sessions.js";
import { deploymentOidcToken, vercelSandboxApi } from "../agents/vercel-sandbox-api.js";
import type { HostedEnvironment } from "../environment.js";
import type { GitHubApp } from "../github/github-app.js";

const CODEX_PLAN_SWEEP = {
  ROUND_MINUTES: 15,
  MIN_SESSIONS: 50,
  MAX_SESSIONS: 1_000,
  CONCURRENCY: 5,
} as const;

const WINDOW_PERIOD_MS = 60_000;

export interface CodexPlanSweepOutcome {
  renewed: number;
  failed: number;
}

function windowOf(standing: number, now: Date) {
  const { ROUND_MINUTES, MIN_SESSIONS, MAX_SESSIONS } = CODEX_PLAN_SWEEP;
  const width = Math.min(MAX_SESSIONS, Math.max(MIN_SESSIONS, Math.ceil(standing / ROUND_MINUTES)));
  if (standing <= width) return { width, pages: [{ offset: 0, limit: standing }] };
  const start = (Math.floor(now.getTime() / WINDOW_PERIOD_MS) * width) % standing;
  const first = Math.min(width, standing - start);
  const pages = [{ offset: start, limit: first }];
  if (first < width) pages.push({ offset: 0, limit: width - first });
  return { width, pages };
}

export const sweepCodexPlanSwaps = /* @__PURE__ */ Effect.fn("web/sweepCodexPlanSwaps")(function* (
  keys: Redacted.Redacted | undefined,
  now: Date,
): Effect.fn.Return<
  CodexPlanSweepOutcome,
  StoreFailure,
  DatabaseServices | HostedEnvironment | HttpClient.HttpClient | GitHubApp
> {
  const ring = keys === undefined ? undefined : parseKeyRing(keys);
  if (ring === undefined || Result.isFailure(ring)) {
    yield* Effect.logWarning(
      "the Codex plans' swaps were not renewed: the deployment has no key ring",
    );
    return { renewed: 0, failed: 0 };
  }
  const api = yield* vercelSandboxApi(deploymentOidcToken);
  const standing = yield* countStandingFirewalls();
  const { width, pages } = windowOf(standing, now);
  if (standing > width * CODEX_PLAN_SWEEP.ROUND_MINUTES) {
    yield* Effect.logWarning("the standing sandbox firewalls outgrew the Codex plans' sweep round");
  }
  const sessions = (yield* Effect.forEach(pages, (page) =>
    listStandingFirewalls(page.offset, page.limit),
  )).flat();
  const renewals = yield* Effect.forEach(
    sessions,
    (session) =>
      Effect.result(renewPlanSwap(api, session, ring.success)).pipe(
        Effect.tap((renewal) =>
          Result.isFailure(renewal)
            ? Effect.logWarning(`a Codex plan's swap was not renewed: ${renewal.failure.message}`)
            : Effect.void,
        ),
      ),
    { concurrency: CODEX_PLAN_SWEEP.CONCURRENCY },
  );
  const came = (outcome: (typeof PLAN_RENEWAL)[keyof typeof PLAN_RENEWAL]) =>
    renewals.filter((renewal) => Result.isSuccess(renewal) && renewal.success === outcome).length;
  return {
    renewed: came(PLAN_RENEWAL.RENEWED),
    failed: renewals.filter(Result.isFailure).length + came(PLAN_RENEWAL.UNANSWERED),
  };
});
