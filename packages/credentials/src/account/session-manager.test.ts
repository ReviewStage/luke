import assert from "node:assert/strict";
import test from "node:test";
import type { AccountClient, StoredAccount } from "./client.js";
import { AccountSessionManager } from "./session-manager.js";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS } from "./snapshot.js";

const STORED: StoredAccount = {
  accessToken: "access",
  refreshToken: "refresh",
  id: "user-1",
  email: "dev@example.com",
  provider: ACCOUNT_PROVIDER.GITHUB,
};

function manager(options: {
  stored?: StoredAccount;
  revoke?: (token: string) => Promise<void>;
  exchangeCode?: () => Promise<{ accessToken: string; refreshToken: string }>;
}) {
  let stored = options.stored;
  const changes: string[] = [];
  const events: string[] = [];
  const authorizations: { redirectUri: string; state: string }[] = [];
  const instance = new AccountSessionManager({
    // SAFETY: Fixture client implements only the AccountClient methods the manager calls.
    client: {
      revoke: options.revoke ?? (async () => undefined),
      userInfo: async () => STORED,
      refresh: async () => ({ accessToken: "new-access", refreshToken: "new-refresh" }),
      authorizeUrl: (input: { redirectUri: string; state: string }) => {
        authorizations.push(input);
        return `https://accounts.example/authorize?state=${encodeURIComponent(input.state)}`;
      },
      exchangeCode:
        options.exchangeCode ??
        (async () => ({ accessToken: "issued-access", refreshToken: "issued-refresh" })),
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
    startCapabilities: async () => {
      events.push("start");
    },
    stopCapabilities: async () => {
      events.push("stop");
    },
    onChange: (account) => changes.push(account.status),
  });
  return { instance, changes, events, authorizations, stored: () => stored };
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

/** Waits for the consent trip to have composed its authorization page. */
async function armed(authorizations: readonly unknown[]): Promise<void> {
  while (authorizations.length === 0) await new Promise((resolve) => setImmediate(resolve));
}

test("a withdrawn sign-in settles signed out rather than reporting a failure", async () => {
  const subject = manager({});
  const pending = subject.instance.beginSignIn(ACCOUNT_PROVIDER.GITHUB);
  await armed(subject.authorizations);

  subject.instance.cancelSignIn();
  assert.equal((await pending).status, ACCOUNT_STATUS.SIGNED_OUT);
});

test("an exchange the account refuses is a failure the panel can report", async () => {
  const subject = manager({
    exchangeCode: () => Promise.reject(new Error("Account refused the exchange")),
  });
  // The rejection is claimed before the callback lands, so the refusal is the
  // assertion rather than an unhandled rejection racing the test.
  const refused = assert.rejects(
    subject.instance.beginSignIn(ACCOUNT_PROVIDER.GITHUB),
    /Account refused the exchange/,
  );
  await armed(subject.authorizations);
  // SAFETY: `armed` returns only once the first authorization was composed.
  const { redirectUri, state } = subject.authorizations[0] as {
    redirectUri: string;
    state: string;
  };
  // The hosted authorize route reads the chosen provider back off the state.
  assert.match(state, /^github\./);

  const callback = new URL(redirectUri);
  callback.searchParams.set("state", state);
  callback.searchParams.set("code", "auth-code");
  const answered = await fetch(callback);
  assert.equal(answered.status, 200);
  assert.match(await answered.text(), /Sign-in was not completed/);

  await refused;
  assert.equal(subject.instance.snapshot.status, ACCOUNT_STATUS.SIGNED_OUT);
});
