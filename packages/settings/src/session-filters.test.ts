import assert from "node:assert/strict";
import test from "node:test";
import { PROVIDER_ID, SESSION_APPLICATION_ID, SESSION_FILTER } from "@sidecar/session";
import { APP_SETTING_SCHEMA } from "./schema.js";

const guard = APP_SETTING_SCHEMA.sessionFilters.guard;

test("an absent selection is valid and reads as the unnarrowed list", () => {
  assert.deepEqual(guard(undefined), { valid: true, value: undefined });
});

test("keeps every filter this build recognizes, in the order chosen", () => {
  const chosen = [
    SESSION_FILTER.LOCAL,
    SESSION_FILTER.CLOUD,
    SESSION_FILTER.VOICE,
    SESSION_FILTER.SUPERSET,
    PROVIDER_ID.CODEX,
    SESSION_APPLICATION_ID.CONDUCTOR,
  ];

  assert.deepEqual(guard(chosen), { valid: true, value: chosen });
});

test("drops a value that names no place, kind, app, or agent here", () => {
  const held = guard([SESSION_FILTER.LOCAL, "a-future-builds-filter", 7, true, {}, null]);

  assert.deepEqual(held, { valid: true, value: [SESSION_FILTER.LOCAL] });
});

test("a repeated value narrows no further than its first", () => {
  const held = guard([SESSION_FILTER.LOCAL, PROVIDER_ID.CODEX, SESSION_FILTER.LOCAL]);

  assert.deepEqual(held, { valid: true, value: [SESSION_FILTER.LOCAL, PROVIDER_ID.CODEX] });
});

test("a selection left with nothing reads as unset", () => {
  assert.deepEqual(guard([]), { valid: true, value: undefined });
  assert.deepEqual(guard(["a-future-builds-filter"]), { valid: true, value: undefined });
});

test("a selection that is not a list is invalid rather than guessed at", () => {
  assert.deepEqual(guard(SESSION_FILTER.LOCAL), { valid: false, value: undefined });
  assert.deepEqual(guard({ filters: [SESSION_FILTER.LOCAL] }), { valid: false, value: undefined });
  assert.deepEqual(guard(7), { valid: false, value: undefined });
});
