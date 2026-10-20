// @vitest-environment jsdom
import { expect, test } from "vitest";
import { pageLeave } from "../src/app/page-leave";

/**
 * page-leave.test.ts -- a tab holds the browser's close and reload back
 * only while the panel holds unsaved work, so a page with nothing to lose
 * keeps its place in the back-forward cache; and the tab's own sends ask
 * the panel first, going past the browser's question once told to leave.
 */

/** Whether the browser would ask before the page goes: a `beforeunload` it was told to hold back. */
function holdsBack(page: EventTarget): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  page.dispatchEvent(event);
  return event.defaultPrevented;
}

test("the browser's close and reload are held back only while a page holds unsaved work", () => {
  const page = new EventTarget();
  const tab = pageLeave(page);
  expect(holdsBack(page)).toBe(false);

  tab.unsavedWork(() => undefined);
  expect(holdsBack(page)).toBe(true);

  // A page standing a newer ask in place of its first still holds work.
  tab.unsavedWork(() => undefined);
  expect(holdsBack(page)).toBe(true);

  tab.unsavedWork(undefined);
  expect(holdsBack(page)).toBe(false);
});

test("a way out with nothing unsaved goes at once", () => {
  const tab = pageLeave(new EventTarget());
  const gone: string[] = [];

  tab.leave(() => gone.push("/sign-in"));

  expect(gone).toEqual(["/sign-in"]);
});

test("a way out while a page holds unsaved work asks the panel, and Leave goes without the browser asking again", () => {
  const page = new EventTarget();
  const tab = pageLeave(page);
  const asked: (() => void)[] = [];
  tab.unsavedWork((leave) => asked.push(leave));
  const gone: boolean[] = [];

  tab.leave(() => gone.push(holdsBack(page)));
  expect(asked).toHaveLength(1);
  expect(gone).toEqual([]);

  asked[0]?.();
  expect(gone).toEqual([false]);
});

test("a page the back-forward cache brings back holds its unsaved work back again", () => {
  const page = new EventTarget();
  const tab = pageLeave(page);
  const asked: (() => void)[] = [];
  tab.unsavedWork((leave) => asked.push(leave));
  tab.leave(() => undefined);
  asked[0]?.();
  expect(holdsBack(page)).toBe(false);

  page.dispatchEvent(new Event("pageshow"));

  expect(holdsBack(page)).toBe(true);
});
