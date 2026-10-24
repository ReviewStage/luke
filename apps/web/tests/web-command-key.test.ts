import assert from "node:assert/strict";
import { COMMAND_KEY } from "@luke/settings/shortcuts";
import { test } from "vitest";
import { browserCommandKey } from "../src/app/web-platform";

/**
 * The key a browser tab presses a chord's Command with: ⌘ on Apple's
 * systems, read from `userAgentData` where the browser has it and from
 * `platform` where it does not, and Ctrl everywhere else, where the Windows
 * key is the system's.
 */

test("a browser on a Mac, an iPad or an iPhone presses Command as ⌘", () => {
  assert.equal(browserCommandKey({ platform: "MacIntel" }), COMMAND_KEY.META);
  assert.equal(browserCommandKey({ platform: "iPad" }), COMMAND_KEY.META);
  assert.equal(browserCommandKey({ platform: "iPhone" }), COMMAND_KEY.META);
  assert.equal(
    browserCommandKey({ platform: "", userAgentData: { platform: "macOS" } }),
    COMMAND_KEY.META,
  );
});

test("a browser on Windows, Linux or ChromeOS presses Command as Ctrl", () => {
  assert.equal(browserCommandKey({ platform: "Win32" }), COMMAND_KEY.CONTROL);
  assert.equal(browserCommandKey({ platform: "Linux x86_64" }), COMMAND_KEY.CONTROL);
  assert.equal(
    browserCommandKey({ platform: "MacIntel", userAgentData: { platform: "Windows" } }),
    COMMAND_KEY.CONTROL,
    "userAgentData is read first",
  );
  assert.equal(
    browserCommandKey({ platform: "", userAgentData: { platform: "Chrome OS" } }),
    COMMAND_KEY.CONTROL,
  );
});
