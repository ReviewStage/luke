// @vitest-environment jsdom

import assert from "node:assert/strict";
import { LIVE_READ } from "@repo/features/live-wire";
import type { AppWorkspacePhotos } from "@repo/host/app-state";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { WorkspaceTile } from "./workspace-tile.js";

const PHOTO_URL = "data:image/png;base64,iVBORw0KGgo=";
const PICTURE_URL = "https://avatars.githubusercontent.com/u/1";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

function mount(
  workspace: {
    id: string;
    name: string;
    photoVersion?: string;
    pictureUrl?: string;
  },
  photos: AppWorkspacePhotos = {},
): HTMLElement {
  handState({}, { [LIVE_READ.WORKSPACE_PHOTOS]: photos });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(onRegistry(AtomRegistry.make(), createElement(WorkspaceTile, { workspace }))),
  );
  return container;
}

interface Face {
  readonly picture: string | undefined;
  readonly letter: string;
  readonly hue: boolean;
}

const letterTile = (letter: string): Face => ({ picture: undefined, letter, hue: true });

const pictureTile = (picture: string): Face => ({ picture, letter: "", hue: false });

function drawn(container: HTMLElement): Face {
  const tile = container.querySelector(".ui-avatar[data-shape='tile']");
  const image = container.querySelector('img[data-loaded="true"]');
  return {
    picture: image?.getAttribute("src") ?? undefined,
    letter: tile?.textContent ?? "",
    hue: tile?.hasAttribute("data-hue") ?? false,
  };
}

function load(container: HTMLElement): void {
  act(() => container.querySelector("img")?.dispatchEvent(new Event("load")));
}

test("a workspace with a photo draws its letter while it loads, then the photo the host holds for its id, with no letter or hue under it", async () => {
  const version = "1a2b3c4d5e6f7a8b";
  const tile = mount(
    { id: "workspace-photo", name: "acme", photoVersion: version },
    { "workspace-photo": { rows: { version, url: PHOTO_URL } } },
  );

  assert.deepEqual(drawn(tile), letterTile("A"));
  await settle();
  await vi.waitFor(() => assert.equal(tile.querySelector("img") !== null, true));
  const read = drawn(tile);
  load(tile);

  assert.deepEqual(read, letterTile("A"), "the letter stands until the photo has loaded");
  assert.deepEqual(drawn(tile), pictureTile(PHOTO_URL));
});

test("a photo the host holds none of at the version the list names, or that fails to load, leaves the letter", async () => {
  const photos: AppWorkspacePhotos = {
    "workspace-stale": { rows: { version: "0c0c0c0c0c0c0c0c", url: PHOTO_URL } },
    "workspace-broken": { rows: { version: "0e0e0e0e0e0e0e0e", url: PHOTO_URL } },
  };
  const missing = mount(
    { id: "workspace-missing", name: "relay", photoVersion: "0f0f0f0f0f0f0f0f" },
    photos,
  );
  const stale = mount(
    { id: "workspace-stale", name: "stale", photoVersion: "0d0d0d0d0d0d0d0d" },
    photos,
  );
  const broken = mount(
    { id: "workspace-broken", name: "zeta", photoVersion: "0e0e0e0e0e0e0e0e" },
    photos,
  );
  await settle();
  await vi.waitFor(() => assert.equal(broken.querySelector("img") !== null, true));
  const offered = broken.querySelector("img") !== null;
  act(() => broken.querySelector("img")?.dispatchEvent(new Event("error")));

  assert.deepEqual(drawn(missing), letterTile("R"));
  assert.equal(stale.querySelector("img"), null, "a photo of another version is not drawn");
  assert.equal(offered, true, "the photo at the version listed is drawn");
  assert.deepEqual(drawn(broken), letterTile("Z"));
});

test("a personal workspace with no photo draws its letter while its owner's picture loads, then the picture alone, and its letter where the picture fails to load", () => {
  const tile = mount({ id: "workspace-personal", name: "Personal", pictureUrl: PICTURE_URL });

  assert.deepEqual(drawn(tile), letterTile("P"));
  load(tile);
  assert.deepEqual(drawn(tile), pictureTile(PICTURE_URL));

  act(() => tile.querySelector("img")?.dispatchEvent(new Event("error")));

  assert.deepEqual(drawn(tile), letterTile("P"));
});

test("a workspace with neither a photo nor a picture draws its letter", async () => {
  const tile = mount({ id: "workspace-plain", name: "plain" });
  await settle();

  assert.deepEqual(drawn(tile), letterTile("P"));
});
