import assert from "node:assert/strict";
import { HOST_NODE_OPEN_KIND } from "@sidecar/host";
import { test } from "vitest";
import { createNodeOpen } from "./node-open";

const CHAT_URL = "https://example.invalid/chat/1";

function harness(options: { fixtureMode?: boolean; opens?: (url: string) => Promise<void> } = {}) {
  const opened: string[] = [];
  let standDowns = 0;
  const open = createNodeOpen({
    openExternal: async (url) => {
      opened.push(url);
      await options.opens?.(url);
    },
    fixtureMode: options.fixtureMode ?? false,
    standPanelsDown: () => {
      standDowns += 1;
    },
  });
  return { open, opened, standDowns: () => standDowns };
}

test("a session opened at an ask of Luke stands the panels down once it has opened", async () => {
  const { open, opened, standDowns } = harness();
  await open(CHAT_URL, HOST_NODE_OPEN_KIND.ASKED_SESSION);
  assert.deepEqual(opened, [CHAT_URL]);
  assert.equal(standDowns(), 1);
});

test("an address with a press already behind it leaves the panels where they are", async () => {
  const { open, opened, standDowns } = harness();
  await open(CHAT_URL, HOST_NODE_OPEN_KIND.ADDRESS);
  assert.deepEqual(opened, [CHAT_URL]);
  assert.equal(standDowns(), 0);
});

test("an open that did not land moves no panel", async () => {
  const { open, standDowns } = harness({
    opens: async () => {
      throw new Error("no application claims that address");
    },
  });
  await assert.rejects(open(CHAT_URL, HOST_NODE_OPEN_KIND.ASKED_SESSION), /claims/);
  assert.equal(standDowns(), 0);
});

test("a fixture run opens the address and leaves its panel to the capture that drives it", async () => {
  const { open, opened, standDowns } = harness({ fixtureMode: true });
  await open(CHAT_URL, HOST_NODE_OPEN_KIND.ASKED_SESSION);
  assert.deepEqual(opened, [CHAT_URL]);
  assert.equal(standDowns(), 0);
});
