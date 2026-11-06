/**
 * codex-plan-sweep.ts -- the scheduled sweep's renewal of the ChatGPT plan token a Codex agent's sandbox carries at its firewall, before the token lapses, for as long as the launch it was set for runs.
 *
 * A Codex launch on its starter's plan in a sandbox holds no token: its token
 * command answers a placeholder, and the launch sets the swap that carries
 * the account's access token in its place on OpenAI's API at the sandbox's
 * firewall (`coder-host/codex-sessions.ts`, `LAUNCH_SWAP.OPENAI_PLAN`). A
 * token lives about an hour and a run may last a day, and nothing in the
 * sandbox asks for another, so this sweep renews it: once a minute it reads
 * a window of the sandbox sessions whose firewall launch is kept, which
 * moves along them from one minute to the next, and in each whose launch
 * holds the plan's swap sets the account's token as it stands behind the
 * same placeholder, renewed first where less than the launch's margin is
 * left of it, and sends the session's whole policy with the agent's
 * repository credential minted afresh (`renewPlanSwap`). A swap that already
 * carries it is left, so a session is written, and its policy sent, only as
 * its account's token moves on, about every quarter hour. The swap stands no
 * longer than its runner: it is cleared ahead of its sandbox's stop, and let
 * go where a Terminal keeps the sandbox up past the runner's end, so a
 * launch's renewals end with it.
 *
 * Note that a swap is set with at least the margin left on its token, and
 * the window is as wide as reads every standing session within a quarter
 * hour (`CODEX_PLAN_SWEEP`), a third of it, so a token lapses under no turn
 * while the account's sign-in still renews. Past fifteen thousand standing
 * sessions, the widest window one sweep reads, the round grows longer, and
 * the sweep says so each minute it does. A renewal whose send failed
 * leaves the kept launch ahead of the policy, and the session's next write
 * sends it, a message's renewal of its GitHub credential or the Terminal's
 * among them, while the token the policy still carries has the margin
 * left. A sign-in that no longer renews leaves the swap as it stands,
 * and OpenAI refuses the turn once its token lapses, as the route refuses a
 * Mac's command, the sweep counting it failed, as it counts OpenAI not
 * answering or the plan's limit reached. What is logged of a failure
 * is its kind and the composer's words, which name no value.
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { parseKeyRing } from "@repo/database/models/provider-key-seal";
import {
  countStandingFirewalls,
  listStandingFirewalls,
} from "@repo/database/models/sandbox-firewall-store";
import { Effect, type Redacted, Result } from "effect";
import type { HttpClient } from "effect/http";
import { PLAN_RENEWAL, renewPlanSwap } from "../agents/coder-host/codex-sessions.js";
import { sandboxFirewall } from "../agents/sandbox-firewall.js";
import { deploymentOidcToken, vercelSandboxApi } from "../agents/vercel-sandbox-api.js";
import type { HostedEnvironment } from "../environment.js";
import type { GitHubApp } from "../github/github-app.js";

const CODEX_PLAN_SWEEP = {
  /** The most minutes between two reads of one standing session, well inside the launch's forty-five minute margin. */
  ROUND_MINUTES: 15,
  /** The fewest sessions one sweep reads, so a deployment with few reads every one each minute. */
  MIN_SESSIONS: 50,
  /** The most sessions one sweep reads, so its minute holds; past it the round grows longer. */
  MAX_SESSIONS: 1_000,
  CONCURRENCY: 5,
} as const;

/** How long one window stands before the next: the sweep's own cadence. */
const WINDOW_PERIOD_MS = 60_000;

/** What one sweep came to: swaps renewed, and sessions whose renewal failed or found no token to set (`PLAN_RENEWAL.UNANSWERED`), each left for a later minute. */
export interface CodexPlanSweepOutcome {
  renewed: number;
  failed: number;
}

/**
 * This minute's window of the `standing` sessions: as wide as reads every
 * one within the round, between the sweep's bounds, starting where the
 * minute puts it and wrapping round, as offsets into their list.
 */
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

/**
 * Renews the plan's token behind every standing swap in this minute's
 * window, `CONCURRENCY` at a time; a deployment with no key ring has no
 * launch it could open, and renews nothing, which it says.
 */
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
  const firewall = sandboxFirewall(yield* vercelSandboxApi(deploymentOidcToken));
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
      Effect.result(renewPlanSwap(firewall, session, ring.success)).pipe(
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
