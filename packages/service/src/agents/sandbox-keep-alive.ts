/**
 * sandbox-keep-alive.ts -- when a sign of use keeps a coding agent's sandbox alive, and by how much.
 *
 * A sandbox opens with a short timeout (`CODER.SANDBOX_TIMEOUT_MS`), so one
 * nothing stopped bills its memory for that long and no longer. Whatever
 * shows it in use keeps it alive: an eve step of the agent or its worker
 * starting, a native runner's events landing, a developer's terminal or
 * watched browser. Each is due at most every `CODER.SANDBOX_KEEP_ALIVE_EVERY`
 * (`keepAliveDue`), and each due one extends the running session so it ends
 * the timeout from now, never past the platform's maximum lifetime
 * (`keepAliveExtension`, which `session-sandboxes.ts`'s `keepAliveFor`
 * applies). The rule reads instants alone, so the eve roots' sandbox policy
 * reads it without the service it is applied through.
 */

import { Duration } from "effect";
import { CODER } from "./coder-host/bounds.js";
import type { SessionLifetime } from "./vercel-sandbox-api.js";

/** The least Vercel extends a session's timeout by, as its REST reference states it. */
const MIN_EXTENSION_MS = 1_000;

/**
 * Whether a sign of use at the instant given is due to keep the sandbox
 * alive: the first, or the first a keep-alive interval after the last that
 * was, so a caller that sees use at every step or batch asks Vercel a few
 * times an hour rather than at each.
 */
export function keepAliveDue(keptAliveAt: number | undefined, now: number): boolean {
  return (
    keptAliveAt === undefined ||
    now - keptAliveAt >= Duration.toMillis(CODER.SANDBOX_KEEP_ALIVE_EVERY)
  );
}

/**
 * How much to lengthen a running session's timeout at the instant given so
 * it ends the timeout from now, kept inside the platform's maximum lifetime;
 * nothing where it already ends within a keep-alive interval of that, so a
 * keep-alive never extends by seconds, or has under Vercel's least extension
 * of lifetime left to grant.
 */
export function keepAliveExtension(lifetime: SessionLifetime, now: number): number | undefined {
  const endsAt = lifetime.startedAt + lifetime.timeoutMs;
  const wanted = now + CODER.SANDBOX_TIMEOUT_MS - endsAt;
  if (wanted < Duration.toMillis(CODER.SANDBOX_KEEP_ALIVE_EVERY)) return undefined;
  const extension = Math.min(wanted, CODER.SANDBOX_MAX_LIFETIME_MS - lifetime.timeoutMs);
  return extension >= MIN_EXTENSION_MS ? extension : undefined;
}
