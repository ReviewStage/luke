// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { Refreshing } from "./chrome/controls.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const FAILURE = "The server did not answer.";

const ANSWER = "1,234 accounts";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

type RefreshingProps = Omit<Parameters<typeof Refreshing>[0], "children">;

interface Mounted {
  readonly page: HTMLElement;
  readonly draw: (props: RefreshingProps) => void;
}

function mount(): Mounted {
  const page = document.createElement("div");
  document.body.append(page);
  const root = createRoot(page);
  roots.push(root);
  return {
    page,
    draw: (props) =>
      act(() => root.render(createElement(Refreshing, { ...props, children: ANSWER }))),
  };
}

test("a failure lands as an alert over the answer still shown, with a Retry that reads again", () => {
  const { page, draw } = mount();
  const retries: string[] = [];
  const onRetry = () => retries.push("retry");
  draw({ failure: undefined, refreshing: false, onRetry });
  expect(page.querySelector('[role="alert"]')).toBeNull();
  expect(page.querySelector("button")).toBeNull();

  draw({ failure: FAILURE, refreshing: false, onRetry });
  const alert = page.querySelector('[role="alert"]');
  expect(alert?.textContent).toContain(
    `Refresh failed. Still showing the earlier answer. ${FAILURE}`,
  );
  expect(page.textContent).toContain(ANSWER);
  act(() => page.querySelector("button")?.click());
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

test("a retry in flight refuses another press and says the answer is busy", () => {
  const { page, draw } = mount();
  const retries: string[] = [];
  draw({ failure: FAILURE, refreshing: true, onRetry: () => retries.push("retry") });
  act(() => page.querySelector("button")?.click());
  expect(retries).toEqual([]);
  expect(page.querySelector('[aria-busy="true"]')?.textContent).toBe(ANSWER);
});
