import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_VOICE, REALTIME_VOICE_SPEED } from "@sidecar/realtime";
import type {
  AccountPreferenceField,
  AccountPreferences,
  AccountPreferencesAnswer,
} from "@sidecar/settings";
import { ACT_RESULT_STATUS } from "@sidecar/wire";
import {
  AccountPreferencesSync,
  type AccountPreferencesSyncStore,
} from "./account-preferences-sync";

class FakeStore implements AccountPreferencesSyncStore {
  settings: AccountPreferences;

  constructor(settings: AccountPreferences = {}) {
    this.settings = settings;
  }

  async accountPreferences(): Promise<AccountPreferences> {
    return this.settings;
  }

  async applyAccountPreferences(
    preferences: AccountPreferences,
  ): Promise<{ status: "accepted"; settings: never; changed: readonly AccountPreferenceField[] }> {
    const changed: AccountPreferenceField[] = [];
    for (const field of [
      "voice",
      "voiceSpeed",
      "defaultWorkspaceProvider",
      "workspaceProjectDefaults",
      "workspaceAgentDefaults",
    ] as const) {
      if (JSON.stringify(this.settings[field]) !== JSON.stringify(preferences[field])) {
        changed.push(field);
      }
    }
    this.settings = preferences;
    // SAFETY: This fake store's tests inspect only `status` and `changed`, not the app settings payload.
    return { status: ACT_RESULT_STATUS.ACCEPTED, settings: undefined as never, changed };
  }
}

function syncFixture(
  options: { store?: FakeStore; remote?: AccountPreferencesAnswer; account?: string } = {},
) {
  const store = options.store ?? new FakeStore();
  const writes: AccountPreferences[] = [];
  const applied: (readonly AccountPreferenceField[])[] = [];
  const account = { current: options.account ?? "user@example.com" };
  const sync = new AccountPreferencesSync({
    settings: store,
    account: async () => (account.current ? { email: account.current } : undefined),
    client: {
      readPreferences: async () => options.remote,
      writePreferences: async (preferences) => {
        writes.push(preferences);
        return { preferences, updatedAt: 1_800_000_000_000 };
      },
    },
    applied: async (_result, changed) => {
      applied.push(changed);
    },
  });
  return { sync, store, writes, applied, account };
}

test("reconcile restores stored account preferences into the desktop store", async () => {
  const store = new FakeStore({ voice: REALTIME_VOICE.SAGE });
  const { sync, applied } = syncFixture({
    store,
    remote: {
      preferences: { voice: REALTIME_VOICE.MARIN, voiceSpeed: REALTIME_VOICE_SPEED.FAST },
      updatedAt: 1_800_000_000_000,
    },
  });

  await sync.reconcile();

  assert.deepEqual(store.settings, {
    voice: REALTIME_VOICE.MARIN,
    voiceSpeed: REALTIME_VOICE_SPEED.FAST,
  });
  assert.deepEqual(applied, [["voice", "voiceSpeed"]]);
});

test("reconcile uploads local account preferences when the account has no row", async () => {
  const store = new FakeStore({ voice: REALTIME_VOICE.CORAL });
  const { sync, writes } = syncFixture({ store, remote: { preferences: {} } });

  await sync.reconcile();

  assert.deepEqual(writes, [{ voice: REALTIME_VOICE.CORAL }]);
});

test("reconcile does not create an empty account row for untouched defaults", async () => {
  const { sync, writes } = syncFixture({ remote: { preferences: {} } });

  await sync.reconcile();

  assert.deepEqual(writes, []);
});

test("preferencesChanged pushes the current local account preferences", async () => {
  const store = new FakeStore({ voiceSpeed: REALTIME_VOICE_SPEED.QUICK });
  const { sync, writes } = syncFixture({ store });

  await sync.preferencesChanged();

  assert.deepEqual(writes, [{ voiceSpeed: REALTIME_VOICE_SPEED.QUICK }]);
});

test("reconcile leaves a newer local account preference when it changes during the read", async () => {
  const store = new FakeStore({ voice: REALTIME_VOICE.SAGE });
  const writes: AccountPreferences[] = [];
  const applied: (readonly AccountPreferenceField[])[] = [];
  const sync = new AccountPreferencesSync({
    settings: store,
    account: async () => ({ email: "user@example.com" }),
    client: {
      readPreferences: async () => {
        store.settings = { voice: REALTIME_VOICE.CORAL };
        return { preferences: { voice: REALTIME_VOICE.MARIN }, updatedAt: 1 };
      },
      writePreferences: async (preferences) => {
        writes.push(preferences);
        return { preferences, updatedAt: 2 };
      },
    },
    applied: async (_result, changed) => {
      applied.push(changed);
    },
  });

  await sync.reconcile();

  assert.deepEqual(store.settings, { voice: REALTIME_VOICE.CORAL });
  assert.deepEqual(writes, []);
  assert.deepEqual(applied, []);
});

test("account preferences sync goes quiet when the account changes mid-reconcile", async () => {
  const store = new FakeStore({ voice: REALTIME_VOICE.SAGE });
  const writes: AccountPreferences[] = [];
  const applied: (readonly AccountPreferenceField[])[] = [];
  const account = { current: "first@example.com" };
  const sync = new AccountPreferencesSync({
    settings: store,
    account: async () => (account.current ? { email: account.current } : undefined),
    client: {
      readPreferences: async () => {
        account.current = "second@example.com";
        return { preferences: { voice: REALTIME_VOICE.MARIN }, updatedAt: 1 };
      },
      writePreferences: async (preferences) => {
        writes.push(preferences);
        return { preferences, updatedAt: 2 };
      },
    },
    applied: async (_result, changed) => {
      applied.push(changed);
    },
  });

  await sync.reconcile();

  assert.deepEqual(store.settings, { voice: REALTIME_VOICE.SAGE });
  assert.deepEqual(writes, []);
  assert.deepEqual(applied, []);
});
