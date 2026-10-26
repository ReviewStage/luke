// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Channel } from "@luke/features/channel-wire";
import { ACT_KIND } from "@luke/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import {
  type ChannelPlaceControl,
  listChannelWorkspace,
  openChannelThread,
  standChannelPlace,
  useChannelPlace,
  useChannels,
  useThreadChannel,
} from "./use-channels.js";

/**
 * use-channels.test.ts -- the channel the window shows: the one last shown
 * in the listed workspace, shown again once its channels are read where it
 * still stands among them, another workspace listed showing its own, and a
 * thread opened by its item alone moved to its own channel once read.
 *
 * Note that the place is the window's, held by the module across this
 * file's tests, so they run in order, each from where the last left it.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const ACME = "workspace-acme";
const LABS = "workspace-labs";

/** A channel as the service answers it, synthetic. */
function channelNamed(name: string, id: string): Channel {
  return { id, name, purpose: "", project: false, createdAt: 1, waiting: 0 };
}

const ACME_GENERAL = channelNamed("general", "a1000001-6d9f-4ab7-92df-000000000001");
const ACME_APP = channelNamed("app", "a1000001-6d9f-4ab7-92df-000000000002");
const LABS_GENERAL = channelNamed("general", "b1000001-6d9f-4ab7-92df-000000000001");
const LABS_DESIGN = channelNamed("design", "b1000001-6d9f-4ab7-92df-000000000002");
const OPS = "workspace-ops";
const OPS_GENERAL = channelNamed("general", "d1000001-6d9f-4ab7-92df-000000000001");
const OPS_DESIGN = channelNamed("design", "d1000001-6d9f-4ab7-92df-000000000002");

const roots: Root[] = [];

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

/** The window's place as a surface drawing it reads it, after the workspace's channels are read as the sidebar reads them. */
async function placeAfterRead(
  workspaceId: string,
  thread?: { readonly id: string; readonly channelId: string },
): Promise<() => ChannelPlaceControl> {
  let seen: ChannelPlaceControl | undefined;
  const Reader = () => {
    useChannels(workspaceId, true);
    useThreadChannel(thread);
    seen = useChannelPlace();
    return null;
  };
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  await act(async () => {
    root.render(onRegistry(AtomRegistry.make(), createElement(Reader)));
    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
  });
  return () => seen ?? assert.fail("the place is read");
}

fakeActPort({
  [ACT_KIND.CHANNELS_LIST]: ({ workspaceId }) =>
    Promise.resolve({
      channels:
        workspaceId === ACME
          ? [ACME_GENERAL, ACME_APP]
          : workspaceId === OPS
            ? [OPS_GENERAL, OPS_DESIGN]
            : [LABS_GENERAL],
    }),
});

test("the channel last shown in the listed workspace is shown again once its channels are read", async () => {
  window.localStorage.setItem(
    "luke.shownChannel",
    JSON.stringify({ [ACME]: ACME_APP.id, [LABS]: LABS_DESIGN.id }),
  );
  listChannelWorkspace(ACME);

  const place = await placeAfterRead(ACME);

  assert.equal(place().channelId, ACME_APP.id);
});

test("another workspace listed shows none of the last one's channels, nor its own last shown where it was archived since, so #general stands in", async () => {
  listChannelWorkspace(LABS);

  const place = await placeAfterRead(LABS);

  assert.equal(place().channelId, undefined);
  assert.equal(place().threadId, undefined);
});

test("a thread opened by its item alone stands in the channel shown until its item is read, then in its own channel", async () => {
  listChannelWorkspace(ACME);
  const itemId = "c1000001-6d9f-4ab7-92df-000000000009";
  act(() => openChannelThread(itemId));

  const place = await placeAfterRead(ACME, { id: itemId, channelId: ACME_APP.id });

  assert.equal(place().channelId, ACME_APP.id);
  assert.equal(place().threadId, itemId);
});

test("a channel a link stands before its workspace's channels are read is kept as the workspace's last once they are, over the one kept before", async () => {
  window.localStorage.setItem("luke.shownChannel", JSON.stringify({ [OPS]: OPS_GENERAL.id }));
  listChannelWorkspace(OPS);
  act(() => standChannelPlace(OPS_DESIGN.id, undefined));

  const place = await placeAfterRead(OPS);

  assert.equal(place().channelId, OPS_DESIGN.id);
  assert.equal(
    JSON.parse(window.localStorage.getItem("luke.shownChannel") ?? "{}")[OPS],
    OPS_DESIGN.id,
  );
});
