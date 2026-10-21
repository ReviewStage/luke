import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { it } from "vitest";
import { whenPageGone } from "./page-gone";

/**
 * When the page behind a window's contents is gone, as the ports main posts
 * to it read it: a reload is an end as much as a close or a crash, and a
 * navigation inside the same document, or of a frame inside it, is none.
 */

it("a page is gone when its contents are destroyed, its renderer dies, or it navigates to a new document", () => {
  const ends: string[] = [];
  const watched = (name: string) => {
    const contents = new EventEmitter();
    whenPageGone(contents, () => ends.push(name));
    return contents;
  };

  const reloaded = watched("reloaded");
  reloaded.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
  reloaded.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
  reloaded.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
  reloaded.emit("destroyed");
  watched("crashed").emit("render-process-gone", {}, { reason: "crashed" });
  watched("closed").emit("destroyed");

  assert.deepEqual(ends, ["reloaded", "crashed", "closed"], "each page ends once");
});
