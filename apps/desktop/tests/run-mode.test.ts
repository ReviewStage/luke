import assert from "node:assert/strict";
import test from "node:test";
import { runModeFor } from "../src/run-mode";

test("a live launch observes, talks, animates, focuses, and may send", () => {
  assert.deepEqual(runModeFor({ capture: false, fixture: false }), {
    observesProviders: true,
    registersGlobalKeys: true,
    animates: true,
    takesFocus: true,
    sendsNetwork: true,
  });
});

test("a fixture launch is deterministic and credential-free, still interactive", () => {
  // `--fixture` without a capture is a person looking: no providers, no
  // network, but the panel still takes focus and the keys still register.
  assert.deepEqual(runModeFor({ capture: false, fixture: true }), {
    observesProviders: false,
    registersGlobalKeys: true,
    animates: true,
    takesFocus: true,
    sendsNetwork: false,
  });
});

test("a capture launch is unattended: no keys, no focus, no motion, no network", () => {
  assert.deepEqual(runModeFor({ capture: true, fixture: false }), {
    observesProviders: false,
    registersGlobalKeys: false,
    animates: false,
    takesFocus: false,
    sendsNetwork: false,
  });
  // Capture always implies fixture, and saying so twice must not change the
  // answer — call sites test a capability, not which flag produced it.
  assert.deepEqual(
    runModeFor({ capture: true, fixture: true }),
    runModeFor({ capture: true, fixture: false }),
  );
});
