// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { RefreshFailureNotice } from "../src/admin/chrome/controls";

/**
 * admin-refresh-failure.test.ts -- a failed refresh is said through a status
 * region that stood on the page before the failure, so a reader is told of
 * it; its words are said once, and the press that retries is a button of
 * its own that answers and holds while the retry runs.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const FAILURE = "The server did not answer.";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** A page holding the notice, and a way to draw it again with new props. */
function mount(): {
  page: HTMLElement;
  draw: (props: { failure: string | undefined; refreshing: boolean; onRetry: () => void }) => void;
} {
  const page = document.createElement("div");
  document.body.append(page);
  const root = createRoot(page);
  roots.push(root);
  return {
    page,
    draw: (props) => act(() => root.render(createElement(RefreshFailureNotice, props))),
  };
}

test("a failure lands in the status region that stood before it, with a retry beside it", () => {
  const { page, draw } = mount();
  const retries: string[] = [];
  const onRetry = () => retries.push("retry");
  draw({ failure: undefined, refreshing: false, onRetry });
  const region = page.querySelector('[role="status"]');
  expect(region?.textContent).toBe("");
  expect(page.querySelector("button")).toBeNull();

  draw({ failure: FAILURE, refreshing: false, onRetry });
  expect(page.querySelector('[role="status"]')).toBe(region);
  expect(region?.textContent).toBe(`Refresh failed. Still showing the earlier answer. ${FAILURE}`);
  const button = page.querySelector("button");
  expect(region?.contains(button)).toBe(false);
  expect(button?.textContent).toBe("Try again");
  act(() => button?.click());
  expect(retries).toEqual(["retry"]);
});

test("the failure's words are said to a reader once", () => {
  const { page, draw } = mount();
  draw({ failure: FAILURE, refreshing: false, onRetry: () => {} });
  const said = [...page.querySelectorAll("*")].filter(
    (element) =>
      element.closest('[aria-hidden="true"]') === null &&
      [...element.childNodes].some(
        (node) => node.nodeType === 3 && node.textContent?.includes(FAILURE),
      ),
  );
  expect(said).toHaveLength(1);
});

test("a retry in flight holds its button and says so", () => {
  const { page, draw } = mount();
  draw({ failure: FAILURE, refreshing: true, onRetry: () => {} });
  const button = page.querySelector("button");
  expect(button?.disabled).toBe(true);
  expect(button?.textContent).toBe("Trying…");
});
