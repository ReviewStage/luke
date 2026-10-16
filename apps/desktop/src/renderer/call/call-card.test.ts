// @vitest-environment jsdom

import assert from "node:assert/strict";
import { WINDOW_ROLE } from "@luke/gateway/window-session";
import type { AppStateSnapshot } from "@luke/host/app-state";
import { LIVE_STATUS } from "@luke/live";
import { EXPERIMENT } from "@luke/settings";
import { experimentsOn } from "@luke/settings/testing";
import { AVATAR_END_REASON, AVATAR_STATUS, type AvatarState } from "@luke/voice/avatar";
import { IDLE_VOICE_VIEW, type VoiceView } from "@luke/voice/voice-view";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { stateWith } from "#testing/app-state";
import { onRegistry } from "#testing/copy-feedback";
import { CALL_CARD_SURFACE, CallCardDock, type CallCardInput, CallWindowCard } from "./call-card";
import { CALL_VIDEO_LABEL } from "./call-video-tile";
import { CallTabVideo, useCallCardVideo } from "./panel-avatar";

/**
 * The call card as a Luke window docks it on a video call: Luke's avatar
 * over the plan's name while it stands, the card alone while there is no
 * video to offer, and its Video off and Video on the very toggle the Call
 * tab's tile presses.
 */

const PLAN_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

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
  callPlanId: PLAN_ID,
};

const CARD: CallCardInput = {
  card: { planName: "Teammate invitations", status: undefined, microphoneMuted: false },
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
function onCall(
  avatar: AvatarState,
  version = 1,
  role: AppStateSnapshot["window"]["role"] = WINDOW_ROLE.PANEL,
): AppStateSnapshot {
  return {
    ...stateWith(experimentsOn(EXPERIMENT.VIDEO_CALLS), {
      voice: { view: LISTENING, avatar },
      window: { role, fullScreen: false },
    }),
    version,
  };
}

/** The bridge as a panel meets it: the document given, every act written down. */
function handBridge(first: AppStateSnapshot): void {
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      requestAppState: () => Promise.resolve(first),
      onAppState: (listener: (snapshot: AppStateSnapshot) => void) => {
        deliver = listener;
        return () => undefined;
      },
      onAvatarSession: () => () => undefined,
      onAvatarFeed: () => () => undefined,
      onAvatarViewSignal: () => () => undefined,
      signalAvatarView: () => undefined,
      onCallWindowMoved: () => () => undefined,
      onMenuCommand: () => () => undefined,
      recordSurfaceEvent: () => undefined,
      act: (request: { kind: string; payload?: unknown }) => {
        sent.push(request);
        return Promise.resolve({ status: "done", value: undefined });
      },
    },
  });
}

function mount(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), element)));
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
    [CALL_VIDEO_LABEL.VIDEO_OFF],
  );

  act(() => root.render(onRegistry(registry, dock(CARD))));
  assert.ok(card(container));
  assert.equal(tileIn(card(container)), null);
  assert.equal(container.querySelector("video"), null);
  assert.equal(container.querySelector(`button[aria-label="${CALL_VIDEO_LABEL.VIDEO_ON}"]`), null);
});

test("the card's Video off and Video on are the Call tab's own toggle, and both views follow the one document", async () => {
  handBridge(onCall({ status: AVATAR_STATUS.LIVE }));
  function Views() {
    const video = useCallCardVideo();
    return createElement(
      "div",
      null,
      createElement(
        "div",
        { className: "call-tab" },
        createElement(CallTabVideo, { planId: PLAN_ID }),
      ),
      createElement(CallCardDock, {
        call: { ...CARD, video },
        surface: CALL_CARD_SURFACE.FLOATING,
      }),
    );
  }
  const page = mount(createElement(Views));
  await settle();
  const callTab = page.querySelector(".call-tab");
  assert.ok(tileIn(callTab), "the Call tab draws the tile");
  const cardTile = tileIn(card(page));
  assert.ok(cardTile, "and so does the card");

  act(() => button(cardTile, CALL_VIDEO_LABEL.VIDEO_OFF).click());
  await settle();
  assert.deepEqual(sent, [{ kind: "voice.setVideo", payload: { on: false } }]);

  // Main's answer, the avatar down at the developer's word, reaches every view at once.
  act(() => deliver(onCall({ status: AVATAR_STATUS.ENDED, endReason: AVATAR_END_REASON.USER }, 2)));
  await settle();
  assert.equal(tileIn(callTab)?.dataset.status, AVATAR_STATUS.OFF);
  assert.equal(tileIn(card(page)), null, "the card falls back to itself");
  act(() => {
    const cardShown = card(page);
    assert.ok(cardShown);
    button(cardShown, CALL_VIDEO_LABEL.VIDEO_ON).click();
  });
  await settle();
  assert.deepEqual(sent.at(-1), { kind: "voice.setVideo", payload: { on: true } });
});

test("the floating call window draws Luke's video while the avatar is live, its Video off is the same act, and once video is down it is the card alone", async () => {
  handBridge(onCall({ status: AVATAR_STATUS.LIVE }, 1, WINDOW_ROLE.CALL));
  const page = mount(createElement(CallWindowCard));
  await settle();
  const windowCard = card(page);
  assert.equal(windowCard?.dataset.surface, CALL_CARD_SURFACE.WINDOW);
  const tile = tileIn(windowCard);
  assert.ok(tile, "the window's card draws the video tile");
  // jsdom has no WebRTC, so the panel's frames never reach it: Luke's still face, not a black box.
  assert.equal(tile.querySelector("video"), null);
  assert.ok(tile.querySelector(".call-video-face"));

  act(() => button(tile, CALL_VIDEO_LABEL.VIDEO_OFF).click());
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
          window: { role: WINDOW_ROLE.CALL, fullScreen: false },
        },
      ),
      version: 2,
    }),
  );
  await settle();
  assert.equal(tileIn(card(page)), null);
  assert.equal(page.querySelector(`button[aria-label="${CALL_VIDEO_LABEL.VIDEO_ON}"]`), null);
});
