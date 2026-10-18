// @vitest-environment jsdom

import assert from "node:assert/strict";
import { TERMINAL_PORT_CHANNEL } from "@luke/features/terminal-acts";
import { test } from "vitest";
import { onTerminalPort } from "./terminal-port.js";

/**
 * The ports main posts for attached shells, as the page receives them: one
 * the preload hands in under the terminal channel, with a ticket naming its
 * shell, reaches the tab; one posted from any other source, or with no
 * ticket, never does.
 */

const TICKET = { agentId: "agent-1", terminalId: "shell-1" };

function received(init: MessageEventInit): readonly unknown[] {
  const heard: unknown[] = [];
  const stop = onTerminalPort((ticket, port) => heard.push({ ticket, port }));
  window.dispatchEvent(new MessageEvent("message", init));
  stop();
  return heard;
}

test("a port the preload hands in under the terminal channel reaches the tab with its ticket", () => {
  const { port1 } = new MessageChannel();
  const heard = received({
    data: { channel: TERMINAL_PORT_CHANNEL, ticket: TICKET },
    source: window,
    ports: [port1],
  });

  assert.deepEqual(heard, [{ ticket: TICKET, port: port1 }]);
});

test("a port from another source, under another channel, or with no ticket never reaches the tab", () => {
  const { port1 } = new MessageChannel();
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const fromFrame = received({
    data: { channel: TERMINAL_PORT_CHANNEL, ticket: TICKET },
    source: frame.contentWindow,
    ports: [port1],
  });
  const otherChannel = received({
    data: { channel: "other", ticket: TICKET },
    source: window,
    ports: [port1],
  });
  const noTicket = received({
    data: { channel: TERMINAL_PORT_CHANNEL },
    source: window,
    ports: [port1],
  });

  assert.deepEqual([fromFrame, otherChannel, noTicket], [[], [], []]);
});
