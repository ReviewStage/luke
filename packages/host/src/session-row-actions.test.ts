import assert from "node:assert/strict";
import test from "node:test";
import { ACTION_KIND, ACTION_REFUSAL } from "@sidecar/actions";
import {
  type ActionHandlers,
  PROVIDER_ID,
  type ProviderSessionObservation,
  SESSION_CONTROL_KIND,
  SESSION_STATUS,
  type SessionProvider,
  type SessionProviderPlugin,
  SessionRoster,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS, UNKNOWN_ACTION_STATUS } from "@sidecar/wire";
import { createSessionActionPerformer } from "./session-action-performer.js";
import { createSessionRowActions } from "./session-row-actions.js";

/*
 * A row's own send and press run the same gauntlet a spoken ask does, and
 * these tests hold them to it at the two ends: the roster is read afresh
 * before anything is decided, and nothing reaches a plugin that the roster
 * did not hold and advertise. The refusals asserted are `admit`'s own
 * sentences, which is what says the gauntlet ran rather than a check of the
 * module's own.
 */

const PROVIDER: SessionProvider = { id: PROVIDER_ID.CONDUCTOR, displayName: "Conductor" };

const NOW = 1_800_000_000_000;

const STOP = {
  kind: ACTION_KIND.CONTROL,
  id: "cancel-run",
  label: "Stop this run",
  controlKind: SESSION_CONTROL_KIND.STOP,
} as const;

/** A working chat that takes a message and advertises one control. */
const WRITABLE: ProviderSessionObservation = {
  providerSessionId: "chat-1",
  title: "Fix the flaky test",
  status: SESSION_STATUS.WORKING,
  lastActivityAt: NOW,
  advertises: [{ kind: ACTION_KIND.MESSAGE }, STOP],
};

/** A chat whose provider documents nothing for it right now. */
const SILENT: ProviderSessionObservation = {
  providerSessionId: "chat-2",
  title: "Write the release notes",
  status: SESSION_STATUS.COMPLETE,
  lastActivityAt: NOW,
};

const IDENTITY = { providerId: PROVIDER.id, providerSessionId: WRITABLE.providerSessionId };

interface Recorded {
  readonly messages: Parameters<ActionHandlers["message"]>[0][];
  readonly controls: Parameters<ActionHandlers["control"]>[0][];
}

function fixture() {
  const messages: Parameters<ActionHandlers["message"]>[0][] = [];
  const controls: Parameters<ActionHandlers["control"]>[0][] = [];
  const plugin: SessionProviderPlugin = {
    provider: PROVIDER,
    observe: async () => [WRITABLE, SILENT],
    latest: () => [WRITABLE, SILENT],
    actions: {
      async message(input) {
        messages.push(input);
        return { status: ACTION_RESULT_STATUS.ACCEPTED };
      },
      async control(input) {
        controls.push(input);
        return { status: ACTION_RESULT_STATUS.ACCEPTED };
      },
    },
  };
  const registry = new SessionRoster();
  registry.replaceProvider(PROVIDER, [WRITABLE, SILENT]);
  const unreachable = async () => {
    throw new Error("the CLI is not reached in these tests");
  };
  const performer = createSessionActionPerformer({
    sessionRegistry: registry,
    openExternal: async () => {},
    pluginFor: (providerId) => (providerId === PROVIDER.id ? plugin : undefined),
    sendsNetwork: true,
    // SAFETY: neither write reads a setting; the store is never reached.
    settingsStore: { get: unreachable as never },
    rememberWorkspaceDefaults: async () => {},
    expectCreatedWorkspace: () => {},
    openCreatedWorkspaces: () => {},
    trackedIssues: () => undefined,
    issueTrackers: [],
    passIssues: () => {},
    supersetContext: () => undefined,
    supersetCli: {
      sendMessage: unreachable,
      executeControl: unreachable,
      createAgent: unreachable,
      renameWorkspace: unreachable,
    },
    recordProductEvent: () => {},
  });
  let rosterReads = 0;
  const rowActions = createSessionRowActions({
    roster: {
      read: async () => {
        rosterReads += 1;
        return registry.list();
      },
    },
    performer,
  });
  const recorded: Recorded = { messages, controls };
  return { rowActions, recorded, rosterReads: () => rosterReads, roster: registry };
}

test("a message typed on a row reaches its provider only after a fresh roster read", async () => {
  const f = fixture();
  const result = await f.rowActions.sendMessage(IDENTITY, "  please add a test for the retry  ");
  assert.deepEqual(result, { status: ACTION_RESULT_STATUS.ACCEPTED });
  assert.equal(f.rosterReads(), 1);
  assert.equal(f.recorded.messages.length, 1);
  // The bounded text admission normalized, never the row's raw keystrokes.
  assert.equal(f.recorded.messages[0]?.request.text, "please add a test for the retry");
  assert.equal(f.recorded.messages[0]?.observation.providerSessionId, WRITABLE.providerSessionId);
});

test("a control pressed on a row carries the advertised entry itself", async () => {
  const f = fixture();
  const result = await f.rowActions.executeControl(IDENTITY, STOP.id);
  assert.deepEqual(result, { status: ACTION_RESULT_STATUS.ACCEPTED });
  assert.equal(f.recorded.controls.length, 1);
  assert.deepEqual(f.recorded.controls[0]?.request.control, STOP);
});

test("an identity the roster does not hold is refused before any plugin is asked", async () => {
  const f = fixture();
  const stranger = { providerId: PROVIDER.id, providerSessionId: "chat-nobody-observed" };
  assert.deepEqual(await f.rowActions.sendMessage(stranger, "hello"), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: ACTION_REFUSAL.NO_SESSION,
  });
  assert.deepEqual(await f.rowActions.executeControl(stranger, STOP.id), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: ACTION_REFUSAL.NO_SESSION,
  });
  assert.equal(f.rosterReads(), 2);
  assert.equal(f.recorded.messages.length, 0);
  assert.equal(f.recorded.controls.length, 0);
});

test("a write the session's latest observation did not advertise is refused", async () => {
  const f = fixture();
  const silent = { providerId: PROVIDER.id, providerSessionId: SILENT.providerSessionId };
  assert.deepEqual(await f.rowActions.sendMessage(silent, "hello"), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: ACTION_REFUSAL.NO_MESSAGES,
  });
  assert.deepEqual(await f.rowActions.executeControl(IDENTITY, "archive-workspace"), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: ACTION_REFUSAL.NO_CONTROL,
  });
  assert.equal(f.recorded.messages.length, 0);
  assert.equal(f.recorded.controls.length, 0);
});

test("an empty or overlong message is refused rather than cut", async () => {
  const f = fixture();
  assert.deepEqual(await f.rowActions.sendMessage(IDENTITY, "   "), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: ACTION_REFUSAL.MESSAGE_BOUND,
  });
  assert.deepEqual(await f.rowActions.sendMessage(IDENTITY, "x".repeat(4_001)), {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: ACTION_REFUSAL.MESSAGE_BOUND,
  });
  assert.equal(f.recorded.messages.length, 0);
});

test("a performed write whose answer cannot be read is unknown, never a refusal to retry", async () => {
  const f = fixture();
  const performed: string[] = [];
  const rowActions = createSessionRowActions({
    roster: { read: async () => f.roster.list() },
    performer: {
      async perform(action) {
        performed.push(action.kind);
        // SAFETY: this is the mis-shaped answer under test, which a performer's erased record type admits.
        return { outcome: "sent" } as never;
      },
    },
  });
  const result = await rowActions.sendMessage(IDENTITY, "hello");
  assert.deepEqual(performed, [ACTION_KIND.MESSAGE]);
  assert.equal(result.status, UNKNOWN_ACTION_STATUS);
});
