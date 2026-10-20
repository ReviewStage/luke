import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import type { ActSender } from "../act-router/router.js";
import { PLATFORM_PORT_ACT_KIND } from "../contract/index.js";
import { refusedPlatformProcedures } from "./index.js";
import { type TestActPort, testActPort } from "./testing.js";

/**
 * A platform that carries none of the platform's port kinds, as a browser
 * tab carries none yet: each is refused in its kind's own sentence, the one
 * the window drew when it rode `app:act`.
 */

const PANEL: ActSender = { sender: Symbol("tab"), panel: true, voice: false, call: false };

const ports: TestActPort<unknown>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

it("every platform kind is refused in its own words, whatever it is sent", async () => {
  const port = testActPort(refusedPlatformProcedures());
  ports.push(port);

  assert.deepEqual(
    await port.call(PANEL, PLATFORM_PORT_ACT_KIND.TERMINAL_LIST, { agentId: "agent-1" }),
    { refused: "Could not reach this agent's sandbox." },
  );
  assert.deepEqual(await port.call(PANEL, PLATFORM_PORT_ACT_KIND.VOICE_STOP_SPEAKING), {
    refused: "Could not tell Luke to stop speaking on this system.",
  });
  assert.deepEqual(await port.call(PANEL, PLATFORM_PORT_ACT_KIND.MAC_REPOSITORIES), {
    refused: "Could not read the run commands set on this Mac.",
  });
  assert.deepEqual(await port.call(PANEL, PLATFORM_PORT_ACT_KIND.UPDATE_CHECK), {
    refused: "Could not check for updates on this system.",
  });
  assert.deepEqual(
    await port.call(PANEL, PLATFORM_PORT_ACT_KIND.BROWSER_CLOSE, { browserId: "browser-1" }),
    { refused: "Could not close the page." },
  );
  assert.deepEqual(await port.call(PANEL, PLATFORM_PORT_ACT_KIND.MICROPHONE_ROUTE), {
    refused: "Could not read the microphone route on this system.",
  });
});
