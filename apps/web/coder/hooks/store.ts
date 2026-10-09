import { Duration, Effect, Redacted, Result } from "effect";
import type { MessageStreamEvent } from "eve/client";
import { defineState } from "eve/context";
import { authenticateGitHub } from "eve/extensions/code/sandbox";
import { defineHook, type HookContext } from "eve/hooks";
import { pinnedState } from "../../server/hosted/brain-host/pinned-state.js";
import { EMPTY_RELAY_STATE, type RelayState } from "../../server/hosted/brain-host/relay.js";
import { CODER } from "../../server/hosted/coder-host/bounds.js";
import type { CheckoutFailure } from "../../server/hosted/coder-host/host.js";
import { SANDBOX_TOOLS } from "../../server/hosted/coder-host/tool-set.js";
import { runWeb } from "../../server/runtime.js";
import { host, seams } from "../host.js";
import { type SandboxRecord, sandboxRecord, sessionPrompt } from "../session-prompt.js";

/**
 * The relay from eve's stream into the store, and the two things the
 * session's sandbox needs of the stream: every event eve records for a
 * session is read here, after eve has written it, and told to the writer as
 * the agent's own event through the relay the planning brain shares
 * (`server/hosted/brain-host/relay.ts`). A session the host does not admit
 * writes nothing. Beside the relay, the hook watches the sandbox: a call of
 * a sandbox tool is when the sandbox opened and its checkout set the
 * repository credential at the firewall, a step that starts past the
 * credential's age renews it there, and a turn's end, however it ended,
 * stops the sandbox at once rather than waiting out its timeout, with its
 * filesystem kept for a later turn to resume.
 */

const relayState = defineState<RelayState>("luke.coder.relay", () => EMPTY_RELAY_STATE);

/** eve's event kinds for a turn's end, each of which stops the sandbox. */
const TURN_END_EVENTS: ReadonlySet<MessageStreamEvent["type"]> = new Set([
  "turn.completed",
  "turn.failed",
  "turn.cancelled",
]);

/** Whether the event is a request for a tool whose every call runs in the sandbox. */
function opensSandbox(event: MessageStreamEvent): boolean {
  return (
    event.type === "actions.requested" &&
    event.data.actions.some(
      (action) => action.kind === "tool-call" && SANDBOX_TOOLS.has(action.toolName),
    )
  );
}

/** Whether the credential set at the firewall is old enough to renew: set when the sandbox opened, or when the hook last renewed it. */
function credentialIsOld(record: SandboxRecord, now: number): boolean {
  const setAt = record.credentialAt ?? record.openedAt;
  return setAt !== undefined && now - setAt >= Duration.toMillis(CODER.GITHUB_TOKEN_REFRESH);
}

/** A refusal as a log line carries it: the checkout's reason, or a store failure's kind. */
function describeRefusal(failure: CheckoutFailure): string {
  return failure._tag === "CheckoutRefused" ? failure.reason : failure._tag;
}

/** A fresh token set at the firewall, where the standing one is old; a renewal that fails is logged and the next step tries again. */
async function renewCredential(
  ctx: HookContext,
  record: ReturnType<typeof pinnedState<SandboxRecord>>,
): Promise<void> {
  const now = seams.now();
  if (!credentialIsOld(record.get(), now)) return;
  const minted = await runWeb(
    Effect.gen(function* () {
      const admitted = yield* host.admit(ctx.session.auth, ctx.session.id);
      if (Result.isFailure(admitted)) return undefined;
      return yield* host.repositoryToken(admitted.success);
    }).pipe(
      Effect.catch((failure) =>
        Effect.as(
          Effect.logWarning(
            `The repository credential of session ${ctx.session.id} was not renewed: ${describeRefusal(failure)}`,
          ),
          undefined,
        ),
      ),
    ),
  );
  if (minted === undefined) return;
  const sandbox = await ctx.getSandbox();
  // The token is revealed here alone, into the firewall rules eve sets for github.com.
  await authenticateGitHub(sandbox, { token: Redacted.value(minted), delivery: "firewall" });
  record.update((held) => ({ ...held, credentialAt: now }));
}

export default defineHook({
  events: {
    async "*"(event, ctx) {
      // Pinned before anything awaits, because the admission's statement can
      // hand this fiber back in another session's context, and the relay's
      // state and the prompt's hash are this session's (`server/hosted/brain-host/pinned-state.ts`).
      const state = pinnedState(relayState);
      const prompt = pinnedState(sessionPrompt);
      const sandbox = pinnedState(sandboxRecord);
      if (opensSandbox(event) && sandbox.get().openedAt === undefined) {
        sandbox.update((held) => ({ ...held, openedAt: seams.now() }));
      }
      await runWeb(
        Effect.gen(function* () {
          if (event.type === "session.started") {
            const starting = yield* host.admitStarting(ctx.session.auth, ctx.session.id);
            if (Result.isFailure(starting)) return;
            if (!(yield* host.sessionStarted(starting.success, ctx.session.id))) return;
          }
          const admitted = yield* host.admit(ctx.session.auth, ctx.session.id);
          if (Result.isFailure(admitted)) return;
          yield* host.relay(event, admitted.success, ctx.session, state, prompt.get());
        }),
      );
      if (event.type === "step.started" && sandbox.get().openedAt !== undefined) {
        await renewCredential(ctx, sandbox);
      }
      // A turn's end stops the sandbox a tool opened; a session whose turn ran no sandbox tool opened none to stop.
      if (TURN_END_EVENTS.has(event.type) && sandbox.get().openedAt !== undefined) {
        const standing = await ctx.getSandbox();
        await standing.stop();
      }
    },
  },
});
