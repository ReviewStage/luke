import assert from "node:assert/strict";
import { test } from "vitest";
import { describedSettings } from "./schema-access.js";
import { settingsView } from "./testing.js";

test("nothing a setting says about itself names a credential or its shape", () => {
  // No settings description may carry a key, a key's shape, or an
  // environment variable's name.
  const forbidden = [/sk-/i, /_API_KEY/, /secret/i, /token/i, /password/i];
  for (const entry of describedSettings(settingsView())) {
    const lines = [entry.label, entry.detail ?? "", entry.value];
    for (const line of lines) {
      for (const pattern of forbidden) {
        assert.ok(!pattern.test(line), `${entry.id} says "${line}"`);
      }
    }
  }
});
