// @vitest-environment jsdom

import assert from "node:assert/strict";
import { WORKSPACE_CALL_FAILURE } from "@luke/features";
import type { TasksWorkspacePhotoAnswer } from "@luke/features/tasks-view";
import { WORKSPACE_PHOTO_TYPE } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeAppBridge } from "#testing/app-bridge";
import { WorkspaceTile } from "./workspace-tile";

/**
 * A workspace's tile as the developer meets it: the photo an owner or admin
 * uploaded once the host answers it, read with the workspace's id; the
 * owner's sign-in picture on a personal workspace with no photo; and the
 * letter where there is neither, while the photo loads, and where an image
 * fails to load. Synthetic workspaces and addresses throughout.
 */

const PHOTO = { contentType: WORKSPACE_PHOTO_TYPE.PNG, base64: "iVBORw0KGgo=" };
const PICTURE_URL = "https://avatars.githubusercontent.com/u/1";

const roots: Root[] = [];

/** Every act the tile sent, in order. */
let sent: { kind: string; payload?: unknown }[] = [];

/** What the host answers a photo read with. */
let answer: TasksWorkspacePhotoAnswer = PHOTO;

beforeEach(() => {
  sent = [];
  answer = PHOTO;
  fakeAppBridge({
    act: (request: { kind: string; payload?: unknown }) => {
      sent.push(request);
      return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: answer });
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The tile for the workspace given, as a row draws it. */
function mount(workspace: {
  id: string;
  name: string;
  photoVersion?: string;
  pictureUrl?: string;
}): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(WorkspaceTile, { workspace })));
  return container;
}

/** What a tile shows: the address of an image once it has loaded, the letter it draws, and whether it is filled with its hue. */
interface Face {
  readonly picture: string | undefined;
  readonly letter: string;
  readonly hue: boolean;
}

/** The letter tile: the letter given on the workspace's hue, and no picture. */
const letterTile = (letter: string): Face => ({ picture: undefined, letter, hue: true });

/** A picture alone, with no letter or hue under it for a transparent photo to show through. */
const pictureTile = (picture: string): Face => ({ picture, letter: "", hue: false });

/** What the tile shows. */
function drawn(container: HTMLElement): Face {
  const tile = container.querySelector(".workspace-tile");
  const image = container.querySelector('img[data-loaded="true"]');
  return {
    picture: image?.getAttribute("src") ?? undefined,
    letter: tile?.textContent ?? "",
    hue: tile?.hasAttribute("data-hue") ?? false,
  };
}

/** The tile's image finishes loading, as the browser says it has. */
function load(container: HTMLElement): void {
  act(() => container.querySelector("img")?.dispatchEvent(new Event("load")));
}

test("a workspace with a photo draws its letter while it loads, then the photo the host read for its id alone, with no letter or hue under it", async () => {
  const tile = mount({ id: "workspace-photo", name: "acme", photoVersion: "1a2b3c4d5e6f7a8b" });

  assert.deepEqual(drawn(tile), letterTile("A"));
  await settle();
  const read = drawn(tile);
  load(tile);

  assert.deepEqual(read, letterTile("A"), "the letter stands until the photo has loaded");
  assert.deepEqual(drawn(tile), pictureTile(`data:image/png;base64,${PHOTO.base64}`));
  assert.deepEqual(sent, [
    { kind: ACT_KIND.WORKSPACE_PHOTO_READ, payload: { workspaceId: "workspace-photo" } },
  ]);
});

test("a photo the host has none of, or that fails to load, leaves the letter", async () => {
  answer = { failure: WORKSPACE_CALL_FAILURE.NOT_FOUND };
  const missing = mount({
    id: "workspace-missing",
    name: "relay",
    photoVersion: "0f0f0f0f0f0f0f0f",
  });
  await settle();
  answer = PHOTO;
  const broken = mount({ id: "workspace-broken", name: "zeta", photoVersion: "0e0e0e0e0e0e0e0e" });
  await settle();
  act(() => broken.querySelector("img")?.dispatchEvent(new Event("error")));

  assert.deepEqual(drawn(missing), letterTile("R"));
  assert.deepEqual(drawn(broken), letterTile("Z"));
});

test("a personal workspace with no photo draws its letter while its owner's picture loads, then the picture alone, and its letter where the picture fails to load", () => {
  const tile = mount({ id: "workspace-personal", name: "Personal", pictureUrl: PICTURE_URL });

  assert.deepEqual(drawn(tile), letterTile("P"));
  load(tile);
  assert.deepEqual(drawn(tile), pictureTile(PICTURE_URL));
  assert.deepEqual(sent, []);

  act(() => tile.querySelector("img")?.dispatchEvent(new Event("error")));

  assert.deepEqual(drawn(tile), letterTile("P"));
});

test("a workspace with neither a photo nor a picture draws its letter and reads nothing", async () => {
  const tile = mount({ id: "workspace-plain", name: "plain" });
  await settle();

  assert.deepEqual(drawn(tile), letterTile("P"));
  assert.deepEqual(sent, []);
});

test("a read of a version asked for again lands though an earlier read of it failed after the second was asked", async () => {
  // Each photo read waits until the test answers it, in the order it was asked.
  const answers: ((value: TasksWorkspacePhotoAnswer) => void)[] = [];
  fakeAppBridge({
    act: () =>
      new Promise((resolve) =>
        answers.push((value) => resolve({ status: ACT_OUTCOME_STATUS.DONE, value })),
      ),
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const draw = (photoVersion: string) =>
    act(() =>
      root.render(
        createElement(WorkspaceTile, {
          workspace: { id: "workspace-flip", name: "flip", photoVersion },
        }),
      ),
    );

  draw("aaaaaaaaaaaaaaaa");
  draw("bbbbbbbbbbbbbbbb");
  draw("aaaaaaaaaaaaaaaa");
  await settle();
  answers[0]?.({ failure: WORKSPACE_CALL_FAILURE.NOT_FOUND });
  await settle();
  answers[2]?.(PHOTO);
  await settle();
  load(container);

  assert.deepEqual(drawn(container), pictureTile(`data:image/png;base64,${PHOTO.base64}`));
});
