// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Channel } from "@luke/features/channel-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { test } from "vitest";
import { LinkWorkspaceProvider } from "../copy-link-item.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { ChannelList } from "./channel-list.js";
import type { ChannelsControl } from "./use-channels.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * channel-list.test.ts -- a phone's list of channels names each channel
 * with its purpose and what waits on the reader in it, the standing
 * channels first and the projects' under their heading, a channel posted in
 * since the reader looked in the unread weight, and a press opens the
 * channel pressed; its "+" asks for a channel to make once the channels are
 * read, and while they are read it stands placeholders and no "+"; a long
 * press offers the channel's menu, whose Mark as read stamps the reader's
 * look and whose Edit asks for the channel's name and purpose, and
 * #general's offers no Archive.
 */

function channel(
  id: string,
  name: string,
  purpose: string,
  project: boolean,
  waiting: number,
  seen: Partial<Channel> = {},
): Channel {
  return { id, name, purpose, project, waiting, createdAt: 0, ...seen };
}

/** A workspace's channels as the window holds them, every look recorded. */
function control(channels: readonly Channel[] | undefined, looks: string[]): ChannelsControl {
  const unasked = () => Promise.resolve(undefined);
  return {
    channels,
    failed: false,
    onRefresh: () => undefined,
    onCreate: () => Promise.resolve({ refused: "Not asked" }),
    onEdit: unasked,
    onArchive: unasked,
    onUnarchive: unasked,
    onMove: unasked,
    onLook: (channelId) => looks.push(channelId),
  };
}

test("the list names each channel with its purpose and count, projects after their heading, the unread in their weight, and a press opens it", () => {
  const opened: string[] = [];
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() =>
    root.render(
      createElement(ChannelList, {
        workspaceId: "workspace-1",
        // Note that the service's order mixes a project's channel among the standing ones.
        channels: control(
          [
            channel("c-app", "app", "The desktop and web apps", false, 2, {
              lookedAt: 10,
              latestPostedAt: 20,
            }),
            channel("c-launch", "launch", "The October launch", true, 0),
            channel("c-general", "general", "Everything else", false, 0, {
              lookedAt: 20,
              latestPostedAt: 10,
            }),
          ],
          [],
        ),
        shown: true,
        onOpen: (channelId) => opened.push(channelId),
        onNew: () => opened.push("new"),
        onEdit: () => assert.fail("nothing is edited here"),
      }),
    ),
  );

  const words = (element: Element) => element.textContent?.replace(/\s+/gu, " ").trim();
  const sections = [...host.querySelectorAll("nav")].map((nav) => ({
    label: nav.getAttribute("aria-label"),
    rows: [...nav.querySelectorAll("button")].map(words),
  }));
  assert.deepEqual(sections, [
    {
      label: "Channels",
      rows: ["appThe desktop and web apps2 need you", "generalEverything else"],
    },
    { label: "Projects", rows: ["launchThe October launch"] },
  ]);
  // The Projects heading stands between the standing channels and the projects'.
  const all = words(host.querySelector(".channel-list-body") ?? host) ?? "";
  assert.ok(all.indexOf("Everything elseProjectslaunch") > 0);
  const unread = [...host.querySelectorAll('[data-unread="true"]')].map(words);
  assert.deepEqual(unread, ["appThe desktop and web apps2 need you"]);

  const general = [...host.querySelectorAll("button")].find((row) =>
    row.textContent?.startsWith("general"),
  );
  act(() => general?.click());
  assert.deepEqual(opened, ["c-general"]);
  act(() => host.querySelector<HTMLButtonElement>('button[aria-label="New channel"]')?.click());
  assert.deepEqual(opened, ["c-general", "new"], "the + asks for a channel to make");
  act(() => root.unmount());
});

test("while the channels are read the list stands placeholders under a + that makes nothing yet", () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() =>
    root.render(
      createElement(ChannelList, {
        workspaceId: "workspace-1",
        channels: control(undefined, []),
        shown: true,
        onOpen: () => undefined,
        onNew: () => assert.fail("nothing is made before the channels are read"),
        onEdit: () => assert.fail("nothing is edited before the channels are read"),
      }),
    ),
  );
  assert.match(host.querySelector('[role="status"]')?.textContent ?? "", /^Reading channels/u);
  assert.equal(host.querySelectorAll("nav button").length, 0, "no channel's row stands yet");
  const add = host.querySelector<HTMLButtonElement>('button[aria-label="New channel"]');
  assert.equal(add?.disabled, true);
  act(() => root.unmount());
});

test("a row's menu copies its link, marks it read, and edits it, and #general's offers no Archive", () => {
  const looks: string[] = [];
  const edits: string[] = [];
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(
          LinkWorkspaceProvider,
          { value: "acme" },
          createElement(ChannelList, {
            workspaceId: "workspace-1",
            channels: control(
              [
                channel("c-app", "app", "The apps", false, 0, { latestPostedAt: 20 }),
                channel("c-general", "general", "Everything else", false, 0),
              ],
              looks,
            ),
            shown: true,
            onOpen: () => undefined,
            onNew: () => undefined,
            onEdit: (edited) => edits.push(edited.id),
          }),
        ),
      ),
    ),
  );
  const menuOf = (name: string) => {
    const row = [...host.querySelectorAll("button")].find((each) =>
      each.textContent?.startsWith(name),
    );
    assert.ok(row, `#${name} is listed`);
    act(() => {
      row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 4, clientY: 4 }));
    });
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    return {
      labels: items.map((item) => item.textContent ?? ""),
      press: (label: string) =>
        act(() => items.find((item) => item.textContent === label)?.click()),
    };
  };

  const app = menuOf("app");
  assert.deepEqual(app.labels, ["Copy link", "Mark as read", "Edit…", "Archive…"]);
  app.press("Mark as read");
  assert.deepEqual(looks, ["c-app"]);

  const general = menuOf("general");
  assert.deepEqual(general.labels, ["Copy link", "Mark as read", "Edit…"]);
  general.press("Edit…");
  assert.deepEqual(edits, ["c-general"]);
  act(() => root.unmount());
  host.remove();
});
