import assert from "node:assert/strict";
import test from "node:test";
import type { AccountClient } from "../src/account-client";
import { AccountSessionManager } from "../src/account-session-manager";
import type { StoredAccount } from "../src/settings-store";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS } from "../src/shared/contracts";

const STORED: StoredAccount = {
  accessToken: "access",
  refreshToken: "refresh",
  email: "dev@example.com",
  provider: ACCOUNT_PROVIDER.GITHUB,
};

function manager(options: { stored?: StoredAccount; revoke?: (token: string) => Promise<void> }) {
  let stored = options.stored;
  const changes: string[] = [];
  const events: string[] = [];
  const instance = new AccountSessionManager({
    client: {
      revoke: options.revoke ?? (async () => undefined),
      userInfo: async () => STORED,
      refresh: async () => ({ accessToken: "new-access", refreshToken: "new-refresh" }),
    } as unknown as AccountClient,
    store: {
      readAccount: async () => stored,
      setAccount: async (next) => {
        stored = next;
        return { status: ACCOUNT_STATUS.SIGNED_IN, ...next };
      },
      clearAccount: async () => {
        stored = undefined;
        return { status: ACCOUNT_STATUS.SIGNED_OUT };
      },
    },
    hostedServiceBaseUrl: "https://example.com",
    requiresAccount: true,
    openExternal: async () => undefined,
    startCapabilities: async () => events.push("start"),
    stopCapabilities: async () => events.push("stop"),
    onChange: (account) => changes.push(account.status),
  });
  return { instance, changes, events, stored: () => stored };
}

test("sign out closes capabilities, clears storage, broadcasts, then revokes", async () => {
  const calls: string[] = [];
  const subject = manager({
    stored: STORED,
    revoke: async () => {
      calls.push("revoke");
    },
  });
  subject.instance.initialize({ status: ACCOUNT_STATUS.SIGNED_IN, ...STORED });
  await subject.instance.signOut({ revokeRemote: true });
  assert.deepEqual(subject.events, ["stop"]);
  assert.deepEqual(subject.changes, [ACCOUNT_STATUS.SIGNED_OUT, ACCOUNT_STATUS.SIGNED_OUT]);
  assert.deepEqual(calls, ["revoke"]);
  assert.equal(subject.stored(), undefined);
});

test("refresh keeps a valid stored account signed in without rewriting it", async () => {
  const subject = manager({ stored: STORED });
  subject.instance.initialize({ status: ACCOUNT_STATUS.SIGNED_IN, ...STORED });
  await subject.instance.refresh();
  assert.equal(subject.instance.snapshot.status, ACCOUNT_STATUS.SIGNED_IN);
  assert.equal(subject.stored()?.accessToken, "access");
});
