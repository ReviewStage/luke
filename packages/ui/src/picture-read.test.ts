// @vitest-environment jsdom

import { QueryClient, QueryClientProvider, queryOptions } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import {
  PICTURE_STATE,
  type PictureAnswer,
  type PictureState,
  readPicture,
  usePicture,
} from "./picture-read.js";
import { recordedFailure } from "./testing/reported-failure.js";

/**
 * picture-read.test.ts -- a picture's read as the place drawing it sees it:
 * one that did not land draws as failed until its retry lands it, and one
 * answered as gone draws as missing. Synthetic pictures, each on a client of
 * its own.
 */

/** What a read that did not land is reported as. */
const { failure: UNREAD } = recordedFailure();

/** Builds the failure of a read that did not land. */
const FAILED = () => UNREAD;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
});

/** Draws the picture `id` read through `read` on a client of its own, keeping the state it was drawn in last. */
async function drawPicture(
  id: string,
  read: () => Promise<PictureAnswer>,
): Promise<{ readonly now: () => PictureState }> {
  let drawn: PictureState = { kind: PICTURE_STATE.READING };
  const query = queryOptions({
    queryKey: ["picture", id],
    queryFn: () => readPicture(read()),
    retry: false,
  });
  function Picture(): null {
    drawn = usePicture(query, FAILED);
    return null;
  }
  const client = new QueryClient();
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  await act(async () =>
    root.render(createElement(QueryClientProvider, { client }, createElement(Picture))),
  );
  return { now: () => drawn };
}

test("a read that did not land draws as failed, and its retry reads it again until it lands", async () => {
  const base64 = "iVBORw==";
  let reads = 0;
  const read = () => {
    reads += 1;
    return reads === 1
      ? Promise.reject(new Error("the host did not answer"))
      : Promise.resolve<PictureAnswer>({ contentType: "image/png", base64 });
  };
  const picture = await drawPicture("a", read);
  await vi.waitFor(() => expect(picture.now().kind).toBe(PICTURE_STATE.FAILED));

  const failed = picture.now();
  await act(async () => {
    if (failed.kind === PICTURE_STATE.FAILED) failed.retry();
  });

  await vi.waitFor(() =>
    expect(picture.now()).toEqual({
      kind: PICTURE_STATE.READY,
      url: `data:image/png;base64,${base64}`,
    }),
  );
});

test("a failure the read answers draws as failed, and a picture gone draws as missing, with no retry", async () => {
  const refused = await drawPicture("a", () => Promise.resolve({ failure: "unreachable" }));
  const gone = await drawPicture("b", () => Promise.resolve({ failure: "not-found" }));

  await vi.waitFor(() => {
    expect(refused.now().kind).toBe(PICTURE_STATE.FAILED);
    expect(gone.now()).toEqual({ kind: PICTURE_STATE.MISSING });
  });
});
