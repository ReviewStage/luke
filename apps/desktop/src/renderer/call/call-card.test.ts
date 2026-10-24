// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { AppStateDelivery, AppStateSnapshot } from "@luke/host/app-state";
import { LIVE_STATUS } from "@luke/live";
import { CALL_CARD_SURFACE, CallCardDock, type CallCardInput } from "@luke/panel/call/call-card";
import { AgentCallVideo, useCallCardVideo } from "@luke/panel/call/panel-avatar";
import { rendererRegistry } from "@luke/panel/renderer-runtime";
import { fakeActPortAnswering, fakeAppBridge, refusedOnPort } from "@luke/panel/testing/app-bridge";
import { deliveryOf, stateWith } from "@luke/panel/testing/app-state";
import { onRegistry } from "@luke/panel/testing/copy-feedback";
import { EXPERIMENT } from "@luke/settings";
import { experimentsOn } from "@luke/settings/testing";
import { CALL_CONTROL_LABEL, CALL_VIDEO_LABEL, TOAST_LOOK } from "@luke/ui";
import { AVATAR_END_REASON, AVATAR_STATUS, type AvatarState } from "@luke/voice/avatar";
import { IDLE_VOICE_VIEW, type VoiceView } from "@luke/voice/voice-view";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { CallWindowCard } from "./call-window-card";

/**
 * The call card as a Luke window docks it on a video call: Luke's avatar
 * over the plan's name while it stands, the card alone while there is no
 * video to offer, and its Video off and Video on the very toggle the Call
 * tab's tile presses.
 */

const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT_ID = "0b5f8c1e-4d3a-4e6b-8f2c-9a1d7e3b5c40";

/** The browser's stream, which jsdom has none of: it holds the tracks it was made from. */
class FakeMediaStream {
  constructor(readonly tracks: readonly MediaStreamTrack[]) {}
}

// SAFETY: the tile only hands a track to a stream, never reads one, so a track's identity is all it needs.
const VIDEO = { kind: "video", id: "avatar-video" } as MediaStreamTrack;

const LISTENING: VoiceView = {
  ...IDLE_VOICE_VIEW,
  voiceStatus: LIVE_STATUS.LISTENING,
  listening: true,
  call: { taskId: TASK_ID, agentId: AGENT_ID },
};

const CARD: CallCardInput = {
  card: { taskName: "Teammate invitations", status: undefined, microphoneMuted: false },
  speakerMuted: false,
  controls: {
    onReturn: () => undefined,
    onToggleMicrophone: () => undefined,
    onToggleSpeaker: () => undefined,
    onEnd: () => undefined,
  },
};

const roots: Root[] = [];

/** Every act the windows sent, as the bridge was handed it. */
let sent: { kind: string; payload?: unknown }[] = [];

/** The document's deliveries after the first read, as main sends them. */
let deliver: (snapshot: AppStateSnapshot) => void = () => undefined;

beforeEach(() => {
  vi.stubGlobal("MediaStream", FakeMediaStream);
  sent = [];
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

/** Main's document on a call in progress with the avatar as given and Video calls on, as the panel or the call window is handed it. */
function onCall(avatar: AvatarState, version = 1): AppStateSnapshot {
  return {
    ...stateWith(experimentsOn(EXPERIMENT.VIDEO_CALLS), {
      voice: { view: LISTENING, avatar },
    }),
    version,
  };
}

/** The bridge as a panel meets it: the document given, every act written down. */
function handBridge(first: AppStateSnapshot): void {
  fakeAppBridge({
    requestAppState: () => Promise.resolve(first),
    onAppState: (heard: (delivery: AppStateDelivery) => void) => {
      const listener = (snapshot: AppStateSnapshot) => heard(deliveryOf(snapshot));
      deliver = listener;
      return () => undefined;
    },
    onAvatarSession: () => () => undefined,
    onAvatarFeed: () => () => undefined,
    onAvatarViewSignal: () => () => undefined,
    signalAvatarView: () => undefined,
    onCallWindowMoved: () => () => undefined,
  });
  fakeActPortAnswering((request) => {
    sent.push(request);
    return Promise.resolve(undefined);
  });
}

function mount(
  element: React.ReactElement,
  registry: AtomRegistry.AtomRegistry = AtomRegistry.make(),
): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(registry, element)));
  return container;
}

/** Lets every promise settled so far run its continuations. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

function button(scope: Element, name: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll("button")].find(
    (each) => each.getAttribute("aria-label") === name,
  );
  assert.ok(found, `${name} is offered`);
  return found;
}

const card = (page: HTMLElement) => page.querySelector<HTMLElement>("section.call-card");
const tileIn = (scope: Element | null) =>
  scope?.querySelector<HTMLElement>(`section[aria-label="${CALL_VIDEO_LABEL.TILE}"]`) ?? null;

test("with video on, the card draws Luke's video over the plan's name, on the track it is handed, and with none to offer it is the card alone", () => {
  const dock = (call: CallCardInput) =>
    createElement(CallCardDock, { call, surface: CALL_CARD_SURFACE.FLOATING });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  const video = { status: AVATAR_STATUS.LIVE, track: VIDEO, onSetVideo: () => undefined };
  act(() => root.render(onRegistry(registry, dock({ ...CARD, video }))));
  const tile = tileIn(card(container));
  assert.ok(tile, "the card draws the video tile");
  // SAFETY: the stream global is stubbed with FakeMediaStream, so the tile made this one.
  assert.deepEqual((tile.querySelector("video")?.srcObject as FakeMediaStream | null)?.tracks, [
    VIDEO,
  ]);
  // Above the name, and with no end of its own: End call stays the bar's.
  const head = card(container)?.querySelector(".call-card-head");
  assert.ok(head && tile.compareDocumentPosition(head) & Node.DOCUMENT_POSITION_FOLLOWING);
  assert.deepEqual(
    [...tile.querySelectorAll("button")].map((each) => each.getAttribute("aria-label")),
    [CALL_CONTROL_LABEL.VIDEO_OFF],
  );

  act(() => root.render(onRegistry(registry, dock(CARD))));
  assert.ok(card(container));
  assert.equal(tileIn(card(container)), null);
  assert.equal(container.querySelector("video"), null);
  assert.equal(
    container.querySelector(`button[aria-label="${CALL_CONTROL_LABEL.VIDEO_ON}"]`),
    null,
  );
});

test("the card's Video off and Video on are the agent's tab's own toggle, and both views follow the one document", async () => {
  handBridge(onCall({ status: AVATAR_STATUS.LIVE }));
  function Views() {
    const video = useCallCardVideo();
    return createElement(
      "div",
      null,
      createElement(
        "div",
        { className: "agent-tab" },
        createElement(AgentCallVideo, { agentId: AGENT_ID }),
      ),
      createElement(CallCardDock, {
        call: { ...CARD, video },
        surface: CALL_CARD_SURFACE.FLOATING,
      }),
    );
  }
  const page = mount(createElement(Views));
  await settle();
  const agentTab = page.querySelector(".agent-tab");
  assert.ok(tileIn(agentTab), "the agent's tab draws the tile");
  const cardTile = tileIn(card(page));
  assert.ok(cardTile, "and so does the card");

  act(() => button(cardTile, CALL_CONTROL_LABEL.VIDEO_OFF).click());
  await settle();
  assert.deepEqual(sent, [{ kind: "voice.setVideo", payload: { on: false } }]);

  // Main's answer, the avatar down at the developer's word, reaches every view at once.
  act(() => deliver(onCall({ status: AVATAR_STATUS.ENDED, endReason: AVATAR_END_REASON.USER }, 2)));
  await settle();
  assert.equal(tileIn(agentTab), null, "the agent's tab puts its tile away");
  assert.equal(tileIn(card(page)), null, "the card falls back to itself");
  act(() => {
    const cardShown = card(page);
    assert.ok(cardShown);
    button(cardShown, CALL_CONTROL_LABEL.VIDEO_ON).click();
  });
  await settle();
  assert.deepEqual(sent.at(-1), { kind: "voice.setVideo", payload: { on: true } });
});

test("the floating call window draws Luke's video while the avatar is live, its Video off is the same act, and once video is down it is the card alone", async () => {
  handBridge(onCall({ status: AVATAR_STATUS.LIVE }));
  const page = mount(createElement(CallWindowCard));
  await settle();
  const windowCard = card(page);
  assert.equal(windowCard?.dataset.surface, CALL_CARD_SURFACE.WINDOW);
  const tile = tileIn(windowCard);
  assert.ok(tile, "the window's card draws the video tile");
  // jsdom has no WebRTC, so the panel's frames never reach it: Luke's still face, not a black box.
  assert.equal(tile.querySelector("video"), null);
  assert.ok(tile.querySelector("svg"));

  act(() => button(tile, CALL_CONTROL_LABEL.VIDEO_OFF).click());
  await settle();
  assert.deepEqual(sent, [{ kind: "voice.setVideo", payload: { on: false } }]);

  // The experiment off with no avatar standing is today's card, with nothing of video on it.
  act(() =>
    deliver({
      ...stateWith(
        {},
        {
          voice: {
            view: LISTENING,
            avatar: { status: AVATAR_STATUS.ENDED, endReason: AVATAR_END_REASON.USER },
          },
        },
      ),
      version: 2,
    }),
  );
  await settle();
  assert.equal(tileIn(card(page)), null);
  assert.equal(page.querySelector(`button[aria-label="${CALL_CONTROL_LABEL.VIDEO_ON}"]`), null);
});

/** ⇧⌘ and a letter, as the window hears the chord a hint names. */
function pressShiftCommand(code: string, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    code,
    key,
    metaKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

test("in the floating call window ⇧⌘M and ⇧⌘S answer, as the mute hints name them, and are claimed from the menu bar", async () => {
  handBridge(onCall({ status: AVATAR_STATUS.OFF }));
  mount(createElement(CallWindowCard));
  await settle();

  const microphone = pressShiftCommand("KeyM", "M");
  await settle();
  assert.equal(microphone.defaultPrevented, true);
  assert.deepEqual(sent, [{ kind: "voice.command", payload: { command: "toggle-microphone" } }]);

  pressShiftCommand("KeyS", "S");
  await settle();
  assert.deepEqual(sent.at(-1), { kind: "voice.command", payload: { command: "mute-speaker" } });
});

test("a press main refuses in the floating call window is said there, as one line over the card", async () => {
  handBridge(onCall({ status: AVATAR_STATUS.OFF }));
  fakeActPortAnswering((request) => {
    sent.push(request);
    return Promise.reject(refusedOnPort("The voice window refused end-call."));
  });
  // The window's own registry, the one its presses' toasts are shown on.
  const page = mount(createElement(CallWindowCard), rendererRegistry);
  await settle();
  const windowCard = card(page);
  assert.ok(windowCard);

  act(() => button(windowCard, CALL_CONTROL_LABEL.END_CALL).click());
  await settle();
  assert.deepEqual(sent, [{ kind: "voice.command", payload: { command: "end-call" } }]);
  const stack = document.querySelector<HTMLElement>('section[aria-label="Notifications"]');
  assert.equal(stack?.dataset.look, TOAST_LOOK.LINE);
  const toasts = [...(stack?.querySelectorAll<HTMLElement>(".luke-toast") ?? [])];
  assert.deepEqual(
    toasts.map((toast) => [toast.dataset.look, toast.textContent]),
    [[TOAST_LOOK.LINE, "The voice window refused end-call."]],
  );
});
