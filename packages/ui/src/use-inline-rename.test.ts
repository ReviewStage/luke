// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { type InlineRename, useInlineRename } from "./use-inline-rename.js";

/**
 * use-inline-rename.test.ts -- a surface's rename opens for the subject it
 * draws, asks for the name an edit ends on, says a refusal until the next
 * edit, lets a refusal a later ask replaced go unsaid, and says nothing of
 * one subject's refusal over another.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** A rename the service answers by hand: each ask waits on the test, in order. */
function heldService() {
  const asks: { subjectId: string; name: string; answer: (renamed: boolean) => void }[] = [];
  const onRename = (subjectId: string, name: string) => {
    return new Promise<boolean>((answer) => {
      asks.push({ subjectId, name, answer });
    });
  };
  return { asks, onRename };
}

/** Mounts a surface drawing `subjectId`, answering the rename it holds now and a way to draw another subject. */
function mount(subjectId: string, onRename: (subjectId: string, name: string) => Promise<boolean>) {
  let rename: InlineRename | undefined;
  function Surface({ id }: { id: string }) {
    rename = useInlineRename(id, onRename);
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() => root.render(createElement(Surface, { id: subjectId })));
  return {
    now: () => rename ?? assert.fail("the surface drew"),
    draw: (id: string) => act(() => root.render(createElement(Surface, { id }))),
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 4; tick += 1) await Promise.resolve();
  });
}

test("an edit opens for the subject drawn, asks for the name it ends on, and a refusal stands until the next edit", async () => {
  const service = heldService();
  const surface = mount("plan-1", service.onRename);
  act(() => surface.now().begin());
  assert.equal(surface.now().editing, true);

  let answered: Promise<boolean> | undefined;
  act(() => {
    answered = surface.now().end("Ship the launch");
  });
  assert.equal(surface.now().editing, false);
  assert.deepEqual(
    service.asks.map(({ subjectId, name }) => ({ subjectId, name })),
    [{ subjectId: "plan-1", name: "Ship the launch" }],
  );
  service.asks[0]?.answer(false);
  await settle();
  assert.equal(await answered, false);
  assert.equal(surface.now().refused, true);

  act(() => surface.now().begin());
  assert.equal(surface.now().refused, false);
});

test("an edit that asks for no name asks nothing and is refused nothing", async () => {
  const service = heldService();
  const surface = mount("plan-1", service.onRename);
  act(() => surface.now().begin());
  let answered: Promise<boolean> | undefined;
  act(() => {
    answered = surface.now().end(undefined);
  });
  assert.equal(await answered, true);
  assert.deepEqual(service.asks, []);
  assert.equal(surface.now().refused, false);
});

test("a refusal a later ask replaced goes unsaid", async () => {
  const service = heldService();
  const surface = mount("plan-1", service.onRename);
  act(() => {
    void surface.now().end("Ship");
  });
  act(() => {
    void surface.now().end("Ship the launch");
  });
  service.asks[0]?.answer(false);
  await settle();
  assert.equal(surface.now().refused, false);
  service.asks[1]?.answer(false);
  await settle();
  assert.equal(surface.now().refused, true);
});

test("one subject's open edit and refusal are held for it, not drawn over another", async () => {
  const service = heldService();
  const surface = mount("plan-1", service.onRename);
  act(() => {
    void surface.now().end("Ship the launch");
  });
  service.asks[0]?.answer(false);
  await settle();
  surface.draw("plan-2");
  assert.equal(surface.now().refused, false);
  surface.draw("plan-1");
  assert.equal(surface.now().refused, true);

  act(() => surface.now().begin());
  surface.draw("plan-2");
  assert.equal(surface.now().editing, false);
  surface.draw("plan-1");
  assert.equal(surface.now().editing, true);
});
