// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Channel } from "@luke/features/channel-wire";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { test } from "vitest";
import { ChannelList } from "./channel-list.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * channel-list.test.ts -- a phone's list of channels names each channel
 * with its purpose and what waits on the reader in it, the standing
 * channels first and the projects' under their heading, and a press opens
 * the channel pressed.
 */

function channel(
  id: string,
  name: string,
  purpose: string,
  project: boolean,
  waiting: number,
): Channel {
  return { id, name, purpose, project, waiting, createdAt: 0 };
}

test("the list names each channel with its purpose and count, projects after their heading, and a press opens it", () => {
  const opened: string[] = [];
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() =>
    root.render(
      createElement(ChannelList, {
        // Note that the service's order mixes a project's channel among the standing ones.
        channels: [
          channel("c-app", "app", "The desktop and web apps", false, 2),
          channel("c-launch", "launch", "The October launch", true, 0),
          channel("c-general", "general", "Everything else", false, 0),
        ],
        onOpen: (channelId) => opened.push(channelId),
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
  const all = words(host) ?? "";
  assert.ok(all.indexOf("Everything elseProjectslaunch") > 0);

  const general = [...host.querySelectorAll("button")].find((row) =>
    row.textContent?.startsWith("general"),
  );
  act(() => general?.click());
  assert.deepEqual(opened, ["c-general"]);
  act(() => root.unmount());
});
