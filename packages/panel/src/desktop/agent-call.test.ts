// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_STATUS,
  type CodingAgentSummary,
  NATIVE_CODING_AGENT_RUNTIMES,
} from "@luke/features/coding-agent-wire";
import { IDLE_TASKS_VIEW, type TaskActivity } from "@luke/features/tasks-view";
import { LIVE_STATUS } from "@luke/live";
import { EXPERIMENT } from "@luke/settings";
import { appSettingsWire, experimentsOn, settingsView } from "@luke/settings/testing";
import { WaveformIcon } from "@luke/ui";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { AVATAR_OFF, AVATAR_STATUS, type AvatarState } from "@luke/voice/avatar";
import { IDLE_VOICE_VIEW, type VoiceView } from "@luke/voice/voice-view";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, test } from "vitest";
import { CALL_VIDEO_LABEL } from "../call/call-video-tile.js";
import type { AgentCallDoors } from "../tasks/agent-call.js";
import { NO_LOOKS } from "../tasks/use-task-looks.js";
import { handState } from "../testing/app-state.js";
import { layContainersAt } from "../testing/container-width.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { codingAgentsControl, tasksControl, UNPINNED_SUMMARY } from "../testing/tasks-control.js";
import { DesktopTasks } from "./desktop-tasks.js";

/**
 * An agent's tab takes calls where the platform has a voice: a Call button,
 * a waveform, beside Dictate, which calls the agent, and while a call into
 * it stands, the call's own controls in the composer's row in the button's
 * place, with no call bar and no line saying what Luke is doing, Luke's
 * video as a small tile whose size is kept, and its glyph wearing the live
 * mark. A platform with no voice hands the tab no doors, and it draws none,
 * and nor does the tab of an agent on Claude Code or Codex, since calls run
 * on eve alone.
 * Synthetic task and agent.
 */

const AGENT: CodingAgentSummary = {
  id: "0b5f8c1e-4d3a-4e6b-8f2c-9a1d7e3b5c40",
  planId: DOCUMENT_TASK.id,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Invite expiry",
  createdAt: 3,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32",
};

const roots: Root[] = [];

beforeEach(installScrollIntoView);

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  window.localStorage.clear();
  document.body.innerHTML = "";
});

/** The task open on its agent's tab, the voice as `voice` stands, the tab taking calls through `calls`. */
async function mountOn(
  calls: AgentCallDoors | undefined,
  voice: VoiceView = IDLE_VOICE_VIEW,
  agent: CodingAgentSummary = AGENT,
  call: { avatar?: AvatarState; activity?: TaskActivity; notice?: React.ReactNode } = {},
): Promise<HTMLElement> {
  handState(
    {},
    {
      settings: appSettingsWire(
        settingsView({
          voiceAvailable: true,
          experiments: experimentsOn(EXPERIMENT.VIDEO_CALLS),
        }),
      ),
      voice: { view: voice, avatar: call.avatar ?? AVATAR_OFF },
      tasks: {
        ...IDLE_TASKS_VIEW,
        ...(call.activity === undefined ? {} : { activity: call.activity }),
      },
    },
  );
  const base = tasksControl();
  const tasks = tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    activeTaskId: DOCUMENT_TASK.id,
    region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_TASK },
    mainTabs: {
      ...base.mainTabs,
      tabs: [{ agent: agent.id }],
      tab: { agent: agent.id },
      openAgents: [agent.id],
    },
    agents: codingAgentsControl({ agents: [agent], agentIds: [agent.id] }),
    calls,
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopTasks, {
          summary: UNPINNED_SUMMARY,
          looks: NO_LOOKS,
          tasks,
          notice: call.notice,
        }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
  return container;
}

/** The agent tab's Call button, where it stands. */
function callButton(page: HTMLElement): HTMLButtonElement | null {
  return page.querySelector<HTMLButtonElement>('.agent-call-button button[aria-label="Call"]');
}

test("an agent's tab offers a Call button beside Dictate where the platform has a voice, which calls that agent, and none where it has not", async () => {
  const pressed: string[] = [];
  const page = await mountOn({ onPress: (agentId) => pressed.push(agentId) });
  const call = callButton(page);
  assert.ok(call, "the Call button stands");
  assert.ok(
    call.closest(".agent-tab")?.querySelector(".dictate-button"),
    "beside Dictate, in the agent's own composer",
  );
  assert.ok(call.closest(".ph-no-capture"), "inside the tab left out of the recording");
  act(() => call.click());
  assert.deepEqual(pressed, [AGENT.id]);
  act(() => roots.pop()?.unmount());

  const web = await mountOn(undefined);
  assert.equal(callButton(web), null);
  assert.equal(web.querySelector(".agent-call-foot"), null);
});

/** A call into the agent, listening. */
const ON_CALL: VoiceView = {
  ...IDLE_VOICE_VIEW,
  voiceStatus: LIVE_STATUS.LISTENING,
  listening: true,
  call: { taskId: DOCUMENT_TASK.id, agentId: AGENT.id },
};

/** The names of the buttons the agent's composer offers, in its row's order. */
function composerButtons(page: HTMLElement): (string | null)[] {
  return [...page.querySelectorAll(".agent-composer-actions button")].map((each) =>
    each.getAttribute("aria-label"),
  );
}

/** The agent tab's video tile, where it stands. */
function videoTile(page: HTMLElement): HTMLElement | null {
  return page.querySelector<HTMLElement>(`section[aria-label="${CALL_VIDEO_LABEL.TILE}"]`);
}

/** The video's room above the composer, where it stands. */
function videoRoom(page: HTMLElement): HTMLElement | null {
  return page.querySelector<HTMLElement>(".agent-call-video");
}

/** The height the video stands at, as its room is told it. */
function videoHeight(page: HTMLElement): string | undefined {
  return videoRoom(page)?.style.getPropertyValue("--call-video-height");
}

/** One of the video's top-corner handles, which it must have. */
function corner(page: HTMLElement, side: "left" | "right"): HTMLElement {
  const handle = videoRoom(page)?.querySelector<HTMLElement>(
    `.agent-call-video-corner[data-corner="${side}"]`,
  );
  assert.ok(handle, `the video has a ${side} corner handle`);
  return handle;
}

/** The tile inside the video's room, which it must hold. */
function tileOf(room: HTMLElement): HTMLElement {
  const tile = room.querySelector<HTMLElement>(".call-video-tile");
  assert.ok(tile);
  return tile;
}

/** A pointer event of `type` at the point given, as the browser hands one to the handle. */
function pointer(type: string, x: number, y: number): MouseEvent {
  return new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
}

test("the Call button is a waveform, not a phone", async () => {
  const page = await mountOn({ onPress: () => undefined });
  const glyph = callButton(page)?.querySelector("svg");
  assert.ok(glyph);
  assert.equal(glyph.outerHTML, renderToStaticMarkup(createElement(WaveformIcon)));
});

test("on a call into the agent, its composer holds the call's four controls in the Call button's place, and no call bar stands", async () => {
  const page = await mountOn({ onPress: () => undefined }, ON_CALL, AGENT, {
    avatar: { status: AVATAR_STATUS.LIVE },
  });

  assert.equal(callButton(page), null, "the call's controls stand in its place");
  const controls = page.querySelector('.agent-composer fieldset[aria-label="Call with Luke"]');
  assert.ok(controls, "the call's controls stand in the composer");
  assert.deepEqual(
    [...controls.querySelectorAll("button")].map((each) => each.getAttribute("aria-label")),
    ["Mute speaker", "Mute microphone", CALL_VIDEO_LABEL.VIDEO_OFF, "End call"],
  );
  assert.equal(
    composerButtons(page).includes("Dictate"),
    false,
    "the call's microphone stands where Dictate would",
  );
  assert.equal(page.querySelector(".call-bar"), null, "no call bar stands over the composer");
  assert.ok(
    page.querySelector('.main-tabs [role="tab"] .agent-calling-glyph'),
    "the agent's tab wears the live mark",
  );
});

test("on a call no line says what Luke is doing: no Listening, no Thinking, and no dots", async () => {
  const page = await mountOn({ onPress: () => undefined }, ON_CALL, AGENT, {
    activity: { planner: {}, notes: true },
  });
  const tab = page.querySelector(".agent-tab");
  assert.ok(tab);
  assert.doesNotMatch(tab.textContent ?? "", /Thinking|Listening|Writing notes/u);
  assert.equal(tab.querySelector(".thinking-dots"), null);
  assert.equal(tab.querySelector(".call-status"), null);
});

test("with video off the video's room goes and the composer's video button turns it on again; with video on it takes a room of its own between the transcript and the composer", async () => {
  const off = await mountOn({ onPress: () => undefined }, ON_CALL, AGENT, {
    avatar: AVATAR_OFF,
  });
  assert.equal(videoTile(off), null);
  assert.equal(videoRoom(off), null, "video off takes the room away");
  assert.ok(composerButtons(off).includes(CALL_VIDEO_LABEL.VIDEO_ON));
  act(() => roots.pop()?.unmount());

  const on = await mountOn({ onPress: () => undefined }, ON_CALL, AGENT, {
    avatar: { status: AVATAR_STATUS.LIVE },
  });
  const tile = videoTile(on);
  assert.ok(tile, "the tile stands");
  const room = videoRoom(on);
  assert.ok(room && room.contains(tile), "in a room of its own");
  const foot = on.querySelector(".agent-tab-foot");
  assert.ok(foot?.contains(room), "at the tab's foot, out of the transcript");
  assert.equal(room.closest(".conversation"), null);
  const composer = on.querySelector(".agent-composer");
  assert.ok(composer);
  assert.ok(
    room.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING,
    "above the composer",
  );
  assert.equal(tile.closest(".agent-composer"), null, "not in the composer");
  assert.equal(
    tile.querySelector(`button[aria-label="${CALL_VIDEO_LABEL.VIDEO_OFF}"]`),
    null,
    "its Video off is the composer's",
  );
});

test("the video's room takes height in the tab's flow, so the transcript ends above it, and stands the video centred in it", async () => {
  const page = await mountOn({ onPress: () => undefined }, ON_CALL, AGENT, {
    avatar: { status: AVATAR_STATUS.LIVE },
  });
  const laid = layContainersAt({});
  try {
    const foot = page.querySelector<HTMLElement>(".agent-call-foot");
    assert.ok(foot);
    const drawn = getComputedStyle(foot);
    assert.notEqual(drawn.position, "absolute", "the foot is in the tab's flow");
    assert.notEqual(drawn.height, "0px", "and takes the room the video needs");
    const room = videoRoom(page);
    assert.ok(room);
    assert.notEqual(getComputedStyle(room).position, "absolute", "nor does the video float");
    assert.equal(getComputedStyle(room).justifyContent, "center", "the video is centred");
    const frame = room.querySelector<HTMLElement>(".agent-call-video-frame");
    assert.ok(frame);
    assert.equal(
      getComputedStyle(frame).aspectRatio,
      "var(--call-video-aspect)",
      "a rectangle at the picture's own aspect",
    );
  } finally {
    laid.remove();
  }
});

test("the video starts at 120 px, its size is held between its bounds, a drag moves it smoothly, and it is kept for the next call", async () => {
  const live = { avatar: { status: AVATAR_STATUS.LIVE } } as const;
  const page = await mountOn({ onPress: () => undefined }, ON_CALL, AGENT, live);
  assert.equal(videoHeight(page), "120px", "a first call opens on 120 px");

  act(() =>
    corner(page, "left").dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })),
  );
  assert.equal(videoHeight(page), "360px", "no larger than the greatest");
  act(() =>
    corner(page, "right").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    ),
  );
  assert.equal(videoHeight(page), "96px", "no smaller than the least");
  act(() =>
    corner(page, "right").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    ),
  );
  assert.equal(videoHeight(page), "112px", "↑ grows it, as it grows upward");

  // A drag from the top-left corner follows the pointer, with no snapping.
  const handle = corner(page, "left");
  act(() => handle.dispatchEvent(pointer("pointerdown", 100, 400)));
  act(() => handle.dispatchEvent(pointer("pointermove", 100, 315)));
  assert.equal(videoHeight(page), "197px", "a drag near 200 px stays where it lands");
  act(() => handle.dispatchEvent(pointer("pointermove", 100, -2000)));
  assert.equal(videoHeight(page), "360px", "a drag past the greatest holds there");
  act(() => handle.dispatchEvent(pointer("pointermove", 100, 330)));
  act(() => handle.dispatchEvent(pointer("pointerup", 100, 330)));
  assert.equal(videoHeight(page), "182px", "it stands where it was left");
  act(() => roots.pop()?.unmount());

  const next = await mountOn({ onPress: () => undefined }, ON_CALL, AGENT, live);
  assert.equal(videoHeight(next), "182px", "the next call opens on the size it was left at");
  act(() => roots.pop()?.unmount());

  // A height kept by hand past the greatest.
  window.localStorage.setItem("luke.callVideoHeight", "9999");
  const kept = await mountOn({ onPress: () => undefined }, ON_CALL, AGENT, live);
  assert.equal(videoHeight(kept), "360px", "a kept height past the greatest is held to it");
});

test("hovering the video brings out its resize controls, each named and reached from the keyboard", async () => {
  const page = await mountOn({ onPress: () => undefined }, ON_CALL, AGENT, {
    avatar: { status: AVATAR_STATUS.LIVE },
  });
  const room = videoRoom(page);
  assert.ok(room);
  const laid = layContainersAt({});
  try {
    const controls = () =>
      [...room.querySelectorAll<HTMLElement>(".agent-call-video-corner")]
        .map((each) => getComputedStyle(each).opacity)
        .join(" ");
    assert.equal(room.dataset.reveal, "false");
    assert.equal(controls(), "0 0", "at rest the video is the video alone");
    act(() => {
      tileOf(room).dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    });
    assert.equal(room.dataset.reveal, "true");
    assert.equal(controls(), "1 1", "under the pointer its corners show");
    act(() => {
      tileOf(room).dispatchEvent(
        new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
      );
    });
    assert.equal(room.dataset.reveal, "false", "and go as the pointer leaves");
  } finally {
    laid.remove();
  }
  const touch = layContainersAt({}, { touch: true });
  try {
    const controls = [...room.querySelectorAll<HTMLElement>(".agent-call-video-corner")].map(
      (each) => getComputedStyle(each).opacity,
    );
    assert.deepEqual(controls, ["1", "1"], "a touch screen, which has no hover, always shows them");
  } finally {
    touch.remove();
  }
  for (const side of ["left", "right"] as const) {
    const handle = corner(page, side);
    assert.equal(handle.tabIndex, 0, `the ${side} corner is reached from the keyboard`);
    assert.match(handle.getAttribute("aria-label") ?? "", /^Resize video/u);
    assert.equal(handle.getAttribute("role"), "slider");
  }
  assert.equal(
    room.querySelector('[aria-label="Video size"], [role="radiogroup"], [role="radio"]'),
    null,
    "the video has no size control, its corners alone resize it",
  );
});

test("on a call the voice's notice line floats just over the video's room, never on the video, and no captions stand anywhere in the tab", async () => {
  const notice = createElement("div", { className: "voice-notice", "data-shown": "true" }, "Lost");
  const page = await mountOn({ onPress: () => undefined }, ON_CALL, AGENT, {
    avatar: { status: AVATAR_STATUS.LIVE },
    notice,
  });
  const line = page.querySelector<HTMLElement>(".voice-notice");
  assert.ok(line, "the notice line rides the call's tab");
  const room = videoRoom(page);
  assert.ok(room);
  assert.equal(room.contains(line), false, "not inside the video's room");
  const laid = layContainersAt({});
  try {
    const holder = line.closest<HTMLElement>(".agent-call-notice");
    assert.ok(holder);
    const drawn = getComputedStyle(holder);
    assert.equal(drawn.position, "absolute");
    assert.equal(drawn.bottom, "100%", "it stands above the foot's top edge, over the transcript");
  } finally {
    laid.remove();
  }
  const tab = page.querySelector(".agent-tab");
  assert.ok(tab);
  assert.equal(tab.querySelector(".voice-caption, .voice-caption-speaker"), null, "no captions");
});

test("an agent on Claude Code or Codex offers the same Call button, which calls that agent, where the platform has a voice", async () => {
  for (const runtime of NATIVE_CODING_AGENT_RUNTIMES) {
    const pressed: string[] = [];
    const page = await mountOn({ onPress: (agentId) => pressed.push(agentId) }, IDLE_VOICE_VIEW, {
      ...AGENT,
      runtime,
    });
    const call = callButton(page);
    assert.ok(call !== null, `${runtime}: the Call button stands`);
    act(() => call.click());
    assert.deepEqual(pressed, [AGENT.id], `${runtime}: it calls the agent`);
    act(() => roots.pop()?.unmount());
    document.body.innerHTML = "";
  }
});
