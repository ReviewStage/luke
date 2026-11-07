// @vitest-environment jsdom

import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { type InlineRename, useInlineRename } from "./use-inline-rename.js";

/**
 * use-inline-rename.test.ts -- a surface's rename opens for the subject it
 * draws, asks for the name an edit ends on, reopens on a refusal holding the
 * name that was typed and says the refusal until the next edit, lets a refusal
 * a later ask replaced go unsaid, and says nothing of one subject's refusal
 * over another. The rename is a mutation of the surface's own, on a client of
 * each surface's own, its answers handed to React a tick after they land.
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

/** A rename the surface asked, by the subject it was asked for. */
interface Asked {
  readonly subjectId: string;
  readonly name: string;
}

/** Mounts a surface drawing `subjectId`, its rename a mutation of its own over `onRename`, answering the rename it holds now and a way to draw another subject. */
function mount(subjectId: string, onRename: (subjectId: string, name: string) => Promise<boolean>) {
  let rename: InlineRename | undefined;
  const client = new QueryClient();
  function Surface({ id }: { id: string }) {
    const mutation = useMutation({
      mutationFn: (asked: Asked) => onRename(asked.subjectId, asked.name),
    });
    rename = useInlineRename(id, {
      run: (subject, name) => mutation.mutate({ subjectId: subject, name }),
      asked: mutation.variables,
      refused: !mutation.isPending && (mutation.isError || mutation.data === false),
      reset: mutation.reset,
    });
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const drawn = (id: string) =>
    createElement(QueryClientProvider, { client }, createElement(Surface, { id }));
  act(() => root.render(drawn(subjectId)));
  return {
    now: () => rename ?? assert.fail("the surface drew"),
    draw: (id: string) => act(() => root.render(drawn(id))),
  };
}

/** Waits until the surface's rename stands as `check` asks, a tick or so after an answer lands. */
async function until(check: () => void): Promise<void> {
  await vi.waitFor(check);
}

test("an edit opens for the subject drawn, asks for the name it ends on, and a refusal stands until the next edit", async () => {
  const service = heldService();
  const surface = mount("plan-1", service.onRename);
  act(() => surface.now().begin());
  assert.equal(surface.now().editing, true);

  act(() => surface.now().end("Ship the launch"));
  assert.equal(surface.now().editing, false);
  await until(() =>
    assert.deepEqual(
      service.asks.map(({ subjectId, name }) => ({ subjectId, name })),
      [{ subjectId: "plan-1", name: "Ship the launch" }],
    ),
  );
  service.asks[0]?.answer(false);
  await until(() => assert.equal(surface.now().refused, true));

  act(() => surface.now().begin());
  await until(() => assert.equal(surface.now().refused, false));
});

test("a refusal reopens the field holding the name that was typed", async () => {
  const service = heldService();
  const surface = mount("plan-1", service.onRename);
  act(() => surface.now().begin());
  act(() => surface.now().end("Ship the launch"));
  assert.equal(surface.now().editing, false);
  assert.equal(surface.now().asked, undefined);
  await until(() => assert.equal(service.asks.length, 1));
  service.asks[0]?.answer(false);
  await until(() => assert.equal(surface.now().editing, true));
  assert.equal(surface.now().asked, "Ship the launch");
  assert.equal(surface.now().refused, true);
});

test("a rejected ask reopens the field too, and one taken leaves it closed", async () => {
  const rejected = mount("plan-1", () => Promise.reject(new Error("offline")));
  act(() => rejected.now().end("Ship the launch"));
  await until(() => assert.equal(rejected.now().editing, true));
  assert.equal(rejected.now().asked, "Ship the launch");

  const service = heldService();
  const taken = mount("plan-2", service.onRename);
  act(() => taken.now().end("Ship"));
  await until(() => assert.equal(service.asks.length, 1));
  service.asks[0]?.answer(true);
  await until(() => assert.equal(taken.now().asked, undefined));
  assert.equal(taken.now().editing, false);
  assert.equal(taken.now().asked, undefined);
});

test("ending the reopened field with a new name asks again, and with none lets the refusal go", async () => {
  const service = heldService();
  const surface = mount("plan-1", service.onRename);
  act(() => surface.now().end("Ship"));
  await until(() => assert.equal(service.asks.length, 1));
  service.asks[0]?.answer(false);
  await until(() => assert.equal(surface.now().refused, true));

  act(() => surface.now().end("Ship the launch"));
  await until(() => assert.equal(surface.now().editing, false));
  assert.equal(surface.now().refused, false);
  await until(() => assert.equal(service.asks.length, 2));
  service.asks[1]?.answer(false);
  await until(() => assert.equal(surface.now().asked, "Ship the launch"));

  act(() => surface.now().end(undefined));
  await until(() => assert.equal(surface.now().asked, undefined));
  assert.equal(surface.now().editing, false);
  assert.equal(surface.now().refused, false);
});

test("an edit that asks for no name asks nothing and is refused nothing", async () => {
  const service = heldService();
  const surface = mount("plan-1", service.onRename);
  act(() => surface.now().begin());
  act(() => surface.now().end(undefined));
  assert.deepEqual(service.asks, []);
  assert.equal(surface.now().refused, false);
});

test("a refusal a later ask replaced goes unsaid", async () => {
  const service = heldService();
  const surface = mount("plan-1", service.onRename);
  act(() => surface.now().end("Ship"));
  act(() => surface.now().end("Ship the launch"));
  await until(() => assert.equal(service.asks.length, 2));
  service.asks[0]?.answer(false);
  await act(async () => undefined);
  assert.equal(surface.now().refused, false);
  service.asks[1]?.answer(false);
  await until(() => assert.equal(surface.now().refused, true));
});

test("one subject's open edit and refusal are held for it, not drawn over another", async () => {
  const service = heldService();
  const surface = mount("plan-1", service.onRename);
  act(() => surface.now().end("Ship the launch"));
  await until(() => assert.equal(service.asks.length, 1));
  service.asks[0]?.answer(false);
  await until(() => assert.equal(surface.now().refused, true));
  surface.draw("plan-2");
  assert.equal(surface.now().refused, false);
  assert.equal(surface.now().asked, undefined);
  assert.equal(surface.now().editing, false);
  surface.draw("plan-1");
  assert.equal(surface.now().refused, true);
  assert.equal(surface.now().asked, "Ship the launch");

  act(() => surface.now().begin());
  surface.draw("plan-2");
  assert.equal(surface.now().editing, false);
  surface.draw("plan-1");
  assert.equal(surface.now().editing, true);
});
