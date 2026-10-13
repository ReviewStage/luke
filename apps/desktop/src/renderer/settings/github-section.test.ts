// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { GitHubConnection } from "@sidecar/hosted/github-connection-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { GitHubSection } from "./github-section";

/**
 * Settings' GitHub row over the connection as the host last read it: Connect
 * GitHub while none is connected or before the first read, Connected as the
 * login with Disconnect once one is, each press opening its own page.
 * Synthetic accounts.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The row over `connection`, keeping which pages its presses asked for. */
function mount(connection: GitHubConnection | undefined) {
  const opened: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(GitHubSection, {
        control: {
          connection,
          onConnect: () => opened.push("connect"),
          onDisconnect: () => opened.push("disconnect"),
        },
      }),
    ),
  );
  const press = (words: string) =>
    act(() =>
      (
        [...container.querySelectorAll("button")].find((each) => each.textContent === words) ??
        assert.fail(`no ${words} button`)
      ).click(),
    );
  return {
    page: container,
    opened,
    press,
    line: () => container.querySelector("small")?.textContent,
  };
}

test("with no GitHub connected, and before the first read, the row offers Connect GitHub, which opens the connect page", () => {
  const disconnected = mount({ connected: false, login: null });
  const unread = mount(undefined);

  disconnected.press("Connect GitHub");
  unread.press("Connect GitHub");

  assert.deepEqual(disconnected.opened, ["connect"]);
  assert.deepEqual(unread.opened, ["connect"]);
  assert.match(disconnected.line() ?? "", /^Connect GitHub to/u);
});

test("with GitHub connected, the row says as whom and offers Disconnect, which opens the disconnect page", () => {
  const named = mount({ connected: true, login: "ada" });
  const unnamed = mount({ connected: true, login: null });

  named.press("Disconnect");

  assert.equal(named.line(), "Connected as ada");
  assert.equal(unnamed.line(), "Connected");
  assert.deepEqual(named.opened, ["disconnect"]);
  assert.equal(
    [...named.page.querySelectorAll("button")].some(
      (each) => each.textContent === "Connect GitHub",
    ),
    false,
  );
});
