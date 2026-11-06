// @vitest-environment jsdom
import assert from "node:assert/strict";
import { resolveObjectURL } from "node:buffer";
import { hostedContract } from "@repo/features/contract";
import { LINK_PLATFORM } from "@repo/features/link-open";
import { getOpenAPIMeta } from "@orpc/openapi";
import { afterEach, test, vi } from "vitest";
import { downloadText, webPlatform } from "../src/app/web-platform";

const COUNTING = { recordSurfaceEvent: () => undefined };

const OFF_THE_WEB = [
  "javascript:alert(document.cookie)",
  "JavaScript:alert(document.cookie)",
  "data:text/html,<script>alert(document.cookie)</script>",
  "vbscript:msgbox(1)",
  "file:///etc/passwd",
  "vespin://acme/plan/3f6c1b2a",
] as const;

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

function tabsOpened(): (string | URL | undefined)[] {
  const opened: (string | URL | undefined)[] = [];
  vi.spyOn(window, "open").mockImplementation((url) => {
    opened.push(url);
    return null;
  });
  return opened;
}

test("a link opens in a tab of its own only where its address is an http or https one", () => {
  const opened = tabsOpened();
  const platform = webPlatform(COUNTING);

  platform.openWeb("https://example.com/docs");
  platform.openWeb("http://localhost:3000/preview");
  for (const address of OFF_THE_WEB) platform.openWeb(address);

  assert.deepEqual(opened, ["https://example.com/docs", "http://localhost:3000/preview"]);
});

test("a GitHub link opens in a tab of its own only where its address is GitHub's", () => {
  const opened = tabsOpened();
  const platform = webPlatform(COUNTING);

  platform.openGitHub("https://github.com/acme/app/pull/7");
  for (const address of [
    ...OFF_THE_WEB,
    "https://example.com/acme/app/pull/7",
    "https://github.com.example.com/acme/app",
    "http://github.com/acme/app",
  ]) {
    platform.openGitHub(address);
  }

  assert.deepEqual(opened, ["https://github.com/acme/app/pull/7"]);
});

test("a download's file stays readable once its press returns, and is let go of as the next download starts", async () => {
  const pressed: { readonly name: string; readonly url: string }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    pressed.push({ name: this.download, url: this.href });
  });
  const readable = (url: string) => resolveObjectURL(url) !== undefined;

  assert.equal(await downloadText({ name: "first.patch", text: "one" }), true);
  const first = pressed.at(-1);
  assert.ok(first !== undefined, "the first file is downloaded");
  assert.equal(first.name, "first.patch");
  assert.ok(readable(first.url), "the first file can be read once its press returns");

  await downloadText({ name: "second.patch", text: "two" });
  const second = pressed.at(-1);
  assert.ok(second !== undefined, "the second file is downloaded");
  assert.equal(second.name, "second.patch");
  assert.equal(readable(first.url), false, "the first file is let go of");
  assert.ok(readable(second.url), "the second file can be read");
});

test("the way to the Mac app is offered on a Mac, and on no other platform", () => {
  window.history.replaceState(null, "", "/acme/plan/3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b");

  assert.match(webPlatform(COUNTING, LINK_PLATFORM.MAC).macAppLink?.() ?? "", /^vespin:/u);
  assert.equal(webPlatform(COUNTING, LINK_PLATFORM.OTHER).macAppLink, undefined);
  assert.equal(webPlatform(COUNTING).macAppLink, undefined);
});

test("the admin dashboard is a link to its page on the tab's own origin, whatever page the tab stands on", () => {
  window.history.replaceState(null, "", "/acme/plan/3f6c1b2a?tab=agent#rollout");

  assert.deepEqual(webPlatform(COUNTING).adminDashboard(), {
    href: `${location.origin}/admin`,
  });
});

test("an agent's page is framed through the service's frame of its version on the tab's own origin, a task's page and an agent's alike", () => {
  window.history.replaceState(null, "", "/acme/plan/3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b");
  const platform = webPlatform(COUNTING);
  const task = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
  const agent = "4b0d6b5e-0a8f-4a8e-9a43-1c5f7f8b2a10";
  const page = "0b6f6b52-2c1e-4f8e-9a4d-7f1c2e9d5a01";
  const declared = (
    procedure: Parameters<typeof getOpenAPIMeta>[0],
    names: Readonly<Record<string, string>>,
  ) => {
    const path = getOpenAPIMeta(procedure)?.path ?? "";
    return new URL(
      path.replace(/\{(\w+)\}/gu, (_, name: string) => names[name] ?? ""),
      location.origin,
    ).href;
  };

  assert.equal(
    platform.pageFrameUrl({ taskId: task, pageId: page, version: 3 }),
    declared(hostedContract.taskFiles.pageFrame, { id: task, page, version: "3" }),
  );
  assert.equal(
    platform.pageFrameUrl({ agentId: agent, pageId: page, version: 1 }),
    declared(hostedContract.agentPages.frame, { id: agent, page, version: "1" }),
  );
});
