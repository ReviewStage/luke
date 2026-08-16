import assert from "node:assert/strict";
import test from "node:test";
import { startAccountLoopback } from "../src/account-loopback";
import { ACCOUNT_PROVIDER } from "../src/shared/contracts";

test("a mismatched state is refused without consuming the callback", async () => {
  const loopback = await startAccountLoopback({ timeoutMs: 2_000 });
  try {
    const refused = await fetch(`${loopback.redirectUri}?code=wrong&state=wrong`);
    assert.equal(refused.status, 400);

    const accepted = await fetch(
      `${loopback.redirectUri}?code=accepted&state=${encodeURIComponent(loopback.state)}`,
    );
    assert.equal(accepted.status, 200);
    assert.equal(await loopback.waitForCode, "accepted");
  } finally {
    await loopback.close();
  }
});

test("a second callback is ignored after the first succeeds", async () => {
  const loopback = await startAccountLoopback({ timeoutMs: 2_000 });
  try {
    const callback = `${loopback.redirectUri}?state=${encodeURIComponent(loopback.state)}`;
    assert.equal((await fetch(`${callback}&code=first`)).status, 200);
    assert.equal((await fetch(`${callback}&code=second`)).status, 409);
    assert.equal(await loopback.waitForCode, "first");
  } finally {
    await loopback.close();
  }
});

test("a matching OAuth refusal ends the sign-in immediately", async () => {
  const loopback = await startAccountLoopback({ timeoutMs: 2_000 });
  try {
    const callback = `${loopback.redirectUri}?state=${encodeURIComponent(loopback.state)}`;
    assert.equal((await fetch(`${callback}&error=access_denied`)).status, 400);
    await assert.rejects(loopback.waitForCode, /access_denied/);
    assert.equal((await fetch(`${callback}&code=too-late`)).status, 409);
  } finally {
    await loopback.close();
  }
});

test("a provider hint keeps a full-entropy state for the hosted choice", async () => {
  const loopback = await startAccountLoopback({
    timeoutMs: 2_000,
    providerHint: ACCOUNT_PROVIDER.GITHUB,
  });
  try {
    assert.match(loopback.state, /^github\.[A-Za-z0-9_-]{43}$/);
    const response = await fetch(
      `${loopback.redirectUri}?code=accepted&state=${encodeURIComponent(loopback.state)}`,
    );
    assert.equal(response.status, 200);
    assert.equal(await loopback.waitForCode, "accepted");
  } finally {
    await loopback.close();
  }
});
