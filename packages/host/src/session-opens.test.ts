import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { ACTION_REFUSAL } from "@sidecar/actions";
import { PRODUCT_EVENT, type ProductEventName } from "@sidecar/analytics";
import {
  CLOUD_AGENT_PROVIDER_ID,
  type ProviderSessionObservation,
  SESSION_APPLICATION_ID,
  SESSION_APPLICATION_SCOPE,
  SESSION_STATUS,
  type SessionIdentity,
  type SessionOpenResult,
  SessionRoster,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS, UNKNOWN_ACTION_STATUS } from "@sidecar/wire";
import { Effect } from "effect";
import { createSessionOpens, NodeAnswerLostError } from "./session-opens.js";

/*
 * A session row's press opens the chat, the chat in one of its provider's
 * apps, or the change beside it. What these tests hold the performer to is
 * where the address comes from — the roster as the service relayed it, never
 * anything a caller carried — what a session that left the roster or stands
 * with nowhere to go is answered, what the node's own refusal or lost answer
 * becomes, and that only an open that landed is counted.
 */

const NOW = 1_800_000_000_000;
const CONDUCTOR = { id: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, displayName: "Conductor" };
const WORKSPACE_LINK = "https://conductor.test/workspace/w-1";
const CHANGE_LINK = "https://github.test/pull/7";
const APP_LINK = "https://claude.test/session/w-1";
const WORKSPACE_IDENTITY: SessionIdentity = {
  providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
  providerSessionId: "w-1",
};
const BARE_IDENTITY: SessionIdentity = {
  providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
  providerSessionId: "w-bare",
};
const GONE_IDENTITY: SessionIdentity = {
  providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR,
  providerSessionId: "w-gone",
};

function observation(
  providerSessionId: string,
  detail: { link?: string; change?: string },
  applications: ProviderSessionObservation["applications"] = [],
): ProviderSessionObservation {
  return {
    providerSessionId,
    title: providerSessionId,
    status: SESSION_STATUS.WAITING,
    lastActivityAt: NOW,
    detail,
    applications,
  };
}

/** The sentence a refusal carries; an accepted open carries none. */
function reasonOf(result: SessionOpenResult): string | undefined {
  return "reason" in result ? result.reason : undefined;
}

function fixture(options: { openExternal?: (url: string) => Promise<void> } = {}) {
  const opens: string[] = [];
  const events: ProductEventName[] = [];
  const registry = new SessionRoster();
  registry.replaceProvider(CONDUCTOR, [
    observation("w-1", { link: WORKSPACE_LINK, change: CHANGE_LINK }, [
      {
        id: SESSION_APPLICATION_ID.CONDUCTOR,
        displayName: "Conductor",
        scope: SESSION_APPLICATION_SCOPE.WORKSPACE,
        link: WORKSPACE_LINK,
      },
      {
        id: SESSION_APPLICATION_ID.CLAUDE,
        displayName: "Claude",
        scope: SESSION_APPLICATION_SCOPE.SESSION,
        link: APP_LINK,
      },
      {
        id: SESSION_APPLICATION_ID.SUPERSET,
        displayName: "Superset",
        scope: SESSION_APPLICATION_SCOPE.SESSION,
      },
    ]),
    observation("w-bare", {}),
  ]);
  const performer = createSessionOpens({
    sessionRegistry: registry,
    openExternal:
      options.openExternal ??
      (async (url) => {
        opens.push(url);
      }),
    recordProductEvent: (name) => {
      events.push(name);
    },
  });
  return { performer, opens, events };
}

it.effect("a press opens the address the roster reported, and is counted", () =>
  Effect.gen(function* () {
    const f = fixture();
    assert.deepEqual(yield* f.performer.openSession(WORKSPACE_IDENTITY), {
      status: ACTION_RESULT_STATUS.ACCEPTED,
    });
    assert.deepEqual(
      yield* f.performer.openSessionApplication(WORKSPACE_IDENTITY, SESSION_APPLICATION_ID.CLAUDE),
      {
        status: ACTION_RESULT_STATUS.ACCEPTED,
      },
    );
    assert.deepEqual(yield* f.performer.openSessionChange(WORKSPACE_IDENTITY), {
      status: ACTION_RESULT_STATUS.ACCEPTED,
    });
    // The row's own press follows the first linked mark in the roster's fixed
    // app order, which here is Claude's, not the workspace's detail link.
    assert.deepEqual(f.opens, [APP_LINK, APP_LINK, CHANGE_LINK]);
    assert.deepEqual(f.events, [
      PRODUCT_EVENT.SESSION_ACTION_SEND,
      PRODUCT_EVENT.SESSION_ACTION_SEND,
      PRODUCT_EVENT.SESSION_ACTION_SEND,
    ]);
  }),
);

it.effect(
  "a session that left the roster and one standing with nowhere to go are refused apart, before the node",
  () =>
    Effect.gen(function* () {
      const f = fixture();
      assert.deepEqual(yield* f.performer.openSession(GONE_IDENTITY), {
        status: ACTION_RESULT_STATUS.UNSUPPORTED,
        reason: ACTION_REFUSAL.NO_SESSION,
      });
      assert.deepEqual(yield* f.performer.openSession(BARE_IDENTITY), {
        status: ACTION_RESULT_STATUS.UNSUPPORTED,
        reason: "That session has no address to open.",
      });
      assert.equal(
        reasonOf(yield* f.performer.openSessionChange(BARE_IDENTITY)),
        "That session reports no pull request.",
      );
      // The app list travels with the roster the caller read, so naming what
      // still opens surfaces nothing the roster withheld.
      assert.equal(
        reasonOf(
          yield* f.performer.openSessionApplication(
            WORKSPACE_IDENTITY,
            SESSION_APPLICATION_ID.CHATGPT,
          ),
        ),
        "That session opens only in Claude, Conductor.",
      );
      assert.equal(
        reasonOf(
          yield* f.performer.openSessionApplication(
            WORKSPACE_IDENTITY,
            SESSION_APPLICATION_ID.SUPERSET,
          ),
        ),
        "That session has no address to open in that app.",
      );
      assert.equal(f.opens.length, 0);
      assert.equal(f.events.length, 0);
    }),
);

it.effect(
  "the node's refusal is the row's sentence, and a lost answer is uncertain, neither counted",
  () =>
    Effect.gen(function* () {
      const failing = fixture({
        openExternal: async () => {
          throw new Error("no application claims that address");
        },
      });
      assert.deepEqual(yield* failing.performer.openSession(WORKSPACE_IDENTITY), {
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: "The system could not open that session.",
      });
      assert.equal(
        reasonOf(
          yield* failing.performer.openSessionApplication(
            WORKSPACE_IDENTITY,
            SESSION_APPLICATION_ID.CLAUDE,
          ),
        ),
        "The system could not open that session in the selected app.",
      );
      assert.equal(
        reasonOf(yield* failing.performer.openSessionChange(WORKSPACE_IDENTITY)),
        "The system could not open that pull request.",
      );
      const lost = fixture({
        openExternal: async () => {
          throw new NodeAnswerLostError("the node's connection closed");
        },
      });
      const uncertain = yield* lost.performer.openSession(WORKSPACE_IDENTITY);
      assert.equal(uncertain.status, UNKNOWN_ACTION_STATUS);
      assert.equal(failing.events.length + lost.events.length, 0);
    }),
);
