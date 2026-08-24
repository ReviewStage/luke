import assert from "node:assert/strict";
import test from "node:test";
import { APP_TOOL_KIND, actNarration } from "./acts.js";

test("a setting act narrates the setting label and accepted value", () => {
  assert.equal(
    actNarration(
      {
        kind: APP_TOOL_KIND.SETTING,
        setting: {
          id: "voice_captions",
          label: "Captions",
          description: "Shows Luke's spoken replies as text.",
          kind: "toggle",
          value: "off",
          defaultValue: "off",
          adjustable: true,
          manual: "Settings, Voice",
        },
        value: "on",
      },
      [],
    ),
    "changed Captions to on",
  );
});
