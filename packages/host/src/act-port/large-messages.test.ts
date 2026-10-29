import assert from "node:assert/strict";
import { createORPCClient } from "@orpc/client";
import type { MessagePortMainLike } from "@orpc/client/message-port";
import { RPCLink } from "@orpc/client/message-port";
import { os } from "@orpc/server";
import { RPCHandler } from "@orpc/server/message-port";
import { afterEach, it } from "vitest";
import { type LargeActPortMessage, noteLargeActPortMessages } from "./large-messages.js";

/**
 * What main notes of a window's act port: each message past half a mebibyte
 * it sends the window, named by the call it answers and the push it carries,
 * read through oRPC's own handler and client so a release that writes its
 * messages differently fails here rather than in a freeze nothing names.
 */

/** Past the half a mebibyte a message must reach to be noted. */
const LARGE = "x".repeat(600_000);

const router = {
  tasks: {
    read: os.handler(({ input }) => ({ body: input === "large" ? LARGE : "small" })),
  },
  pushes: os.handler(async function* () {
    yield { push: "app:state", payload: { body: "small" } };
    yield { push: "app:state", payload: { body: LARGE } };
  }),
};

const channels: MessageChannel[] = [];

afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
});

/** A client whose calls main's handler answers through the noting port, and the notes it took. */
function window() {
  const channel = new MessageChannel();
  channels.push(channel);
  // Electron's main-process port, which hands its listener the event, over a DOM port.
  const mainPort: MessagePortMainLike = {
    on: (event, callback) => {
      if (event === "message") channel.port1.addEventListener("message", callback);
    },
    postMessage: (data, transfer) => channel.port1.postMessage(data, transfer ?? []),
  };
  const notes: LargeActPortMessage[] = [];
  new RPCHandler(router).upgrade(noteLargeActPortMessages(mainPort, (note) => notes.push(note)));
  channel.port1.start();
  const client = createORPCClient<{
    tasks: { read: (input: string) => Promise<{ body: string }> };
    pushes: () => Promise<AsyncIterable<{ push: string }>>;
  }>(new RPCLink({ port: channel.port2 }));
  channel.port2.start();
  return { client, notes };
}

it("a large answer is noted by the procedure it answers, and a small one not at all", async () => {
  const { client, notes } = window();

  await client.tasks.read("small");
  await client.tasks.read("large");

  assert.deepEqual(
    notes.map(({ procedure, push }) => ({ procedure, push })),
    [{ procedure: "/tasks/read", push: undefined }],
  );
  assert.ok(notes[0] !== undefined && notes[0].length > LARGE.length);
});

it("a large push is noted by its name and the stream it rides", async () => {
  const { client, notes } = window();

  for await (const _push of await client.pushes());

  assert.deepEqual(
    notes.map(({ procedure, push }) => ({ procedure, push })),
    [{ procedure: "/pushes", push: "app:state" }],
  );
});
