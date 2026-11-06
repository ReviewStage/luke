// @vitest-environment jsdom

import assert from "node:assert/strict";
import { HOST_LIVE, type HostLive, IDLE_TASKS_VIEW } from "@repo/features/tasks-view";
import type { AppStateDelivery, AppStateSnapshot } from "@repo/host/app-state";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { announcedPolitely, mountAnnouncer } from "../testing/announcer.js";
import { fakeAppBridge, fakeAppBridgeCalls } from "../testing/app-bridge.js";
import { deliveryOf, stateWith } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { OfflineMark } from "./offline-mark.js";

/**
 * The pill says what the window shows may be behind, from main's document:
 * offline while the Mac or the service is, the service's calls going
 * unanswered among it, catching up while the host's live follow is behind,
 * and nothing once it is live again. Each document is
 * delivered as main's push delivers it.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** Main's document with the Mac's network, the host's live state, and whether the service answers its calls, as given. */
function documentOf(
  online: boolean,
  live: HostLive | undefined,
  version = 1,
  reachable = true,
): AppStateSnapshot {
  const tasks = live === undefined ? IDLE_TASKS_VIEW : { ...IDLE_TASKS_VIEW, live };
  return { ...stateWith({}, { network: { online, reachable }, tasks }), version };
}

/** The pill drawn over `first`, and a push that delivers a later document to it. */
async function mount(first: AppStateSnapshot): Promise<(next: AppStateSnapshot) => Promise<void>> {
  const listeners = new Set<(delivery: AppStateDelivery) => void>();
  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    requestAppState: () => Promise.resolve(first),
    onAppState: (listener: (delivery: AppStateDelivery) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  await act(async () => root.render(onRegistry(AtomRegistry.make(), createElement(OfflineMark))));
  return (next) =>
    act(async () => {
      for (const listener of listeners) listener(deliveryOf(next));
    });
}

/** The pill's announced name, or none where nothing is drawn. */
function said(): string | undefined {
  return document.querySelector(".offline-mark")?.getAttribute("aria-label") ?? undefined;
}

/** Why the pill says what it says, as its hint's words are heard. */
function why(): string | undefined {
  const mark = document.querySelector(".offline-mark");
  const id = mark?.getAttribute("aria-describedby") ?? mark?.getAttribute("aria-owns");
  return id == null ? undefined : (document.getElementById(id)?.textContent ?? undefined);
}

test("nothing is drawn while the Mac is online and live updates are current", async () => {
  await mount(documentOf(true, HOST_LIVE.LIVE));
  await vi.waitFor(() => assert.equal(said(), undefined));
});

test("a host whose follow has said nothing yet reads as live", async () => {
  await mount(documentOf(true, undefined));
  await vi.waitFor(() => assert.equal(said(), undefined));
});

test("a broken follow says catching up, and its recovery clears it", async () => {
  const push = await mount(documentOf(true, HOST_LIVE.LIVE));

  await push(documentOf(true, HOST_LIVE.CATCHING_UP, 2));
  await vi.waitFor(() => assert.equal(said(), "Catching up"));
  assert.equal(document.querySelector(".offline-mark-word")?.textContent, "Catching up");

  await push(documentOf(true, HOST_LIVE.LIVE, 3));
  await vi.waitFor(() => assert.equal(said(), undefined));
});

test("the pill going offline or catching up is announced politely as it changes, and taken back once live", async () => {
  mountAnnouncer();
  const push = await mount(documentOf(true, HOST_LIVE.LIVE));
  await vi.waitFor(() => assert.equal(announcedPolitely(), ""));

  await push(documentOf(true, HOST_LIVE.CATCHING_UP, 2));
  await vi.waitFor(() => assert.equal(announcedPolitely(), "Catching up"));

  await push(documentOf(false, HOST_LIVE.CATCHING_UP, 3));
  await vi.waitFor(() => assert.equal(announcedPolitely(), "Offline"));

  await push(documentOf(true, HOST_LIVE.LIVE, 4));
  await vi.waitFor(() => assert.equal(announcedPolitely(), ""));
});

test("a service that answers no seal says offline while the Mac is online", async () => {
  const push = await mount(documentOf(true, HOST_LIVE.OFFLINE));
  await vi.waitFor(() => assert.equal(said(), "Offline"));

  await push(documentOf(true, HOST_LIVE.LIVE, 2));
  await vi.waitFor(() => assert.equal(said(), undefined));
});

test("a service whose calls go unanswered says it isn't answering while the Mac is online, and an answer clears it", async () => {
  const push = await mount(documentOf(true, HOST_LIVE.LIVE, 1, false));
  await vi.waitFor(() => assert.equal(said(), "Offline"));
  await vi.waitFor(() => assert.equal(why(), "The service isn't answering."));

  await push(documentOf(true, HOST_LIVE.LIVE, 2));
  await vi.waitFor(() => assert.equal(said(), undefined));
});

test("the Mac offline says offline, whatever the follow last found", async () => {
  await mount(documentOf(false, HOST_LIVE.CATCHING_UP));
  await vi.waitFor(() => assert.equal(said(), "Offline"));
});
