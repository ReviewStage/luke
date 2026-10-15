import assert from "node:assert/strict";
import type { AvatarGrant } from "@luke/features/avatar-grant";
import { AVATAR_FEED_KIND } from "@luke/voice/avatar";
import type { UnparsedWireValue } from "@luke/wire";
import { describe, it } from "vitest";
import { channels } from "#shared/bridge";
import { type AvatarPage, PanelAvatarRelay } from "./panel-avatar";

const GRANT: AvatarGrant = {
  serverUrl: "wss://luke-avatar.livekit.cloud",
  participantToken: "eyJhbGciOiJIUzI1NiJ9.token",
  agentIdentity: "keyframe-agent",
};

interface Sent {
  channel: string;
  payload: UnparsedWireValue;
}

/** A page that records what it was sent, standing for one renderer's `webContents`. */
function page(): AvatarPage & { sent: Sent[] } {
  const sent: Sent[] = [];
  return { sent, send: (channel, payload) => sent.push({ channel, payload }) };
}

/** The windows main holds during a call: the panel's page, the floating call window's, and the voice window's. */
function windows() {
  const call = page();
  const panel = page();
  const voice = page();
  let drawn: AvatarPage | undefined;
  const relay = new PanelAvatarRelay(() => drawn);
  return {
    call,
    panel,
    voice,
    relay,
    draw: (next: AvatarPage | undefined) => {
      drawn = next;
    },
  };
}

describe("the call's avatar relay", () => {
  it("hands the grant to the panel's page and to no other window", () => {
    const w = windows();
    w.draw(w.panel);
    w.relay.showAvatarSession(GRANT);
    w.relay.feedAvatar({ kind: AVATAR_FEED_KIND.TURN_END });
    w.relay.showAvatarSession(undefined);
    assert.deepEqual(w.panel.sent, [
      { channel: channels.onAvatarSession, payload: GRANT },
      { channel: channels.onAvatarFeed, payload: { kind: AVATAR_FEED_KIND.TURN_END } },
      { channel: channels.onAvatarSession, payload: undefined },
    ]);
    assert.deepEqual(w.call.sent, []);
    assert.deepEqual(w.voice.sent, []);
  });

  it("hands a page that draws after the grant the grant standing, and the feed it missed not at all", () => {
    const w = windows();
    w.relay.showAvatarSession(GRANT);
    w.relay.feedAvatar({ kind: AVATAR_FEED_KIND.INTERRUPT });
    w.draw(w.panel);
    w.relay.pageDrew();
    assert.deepEqual(w.panel.sent, [{ channel: channels.onAvatarSession, payload: GRANT }]);
  });

  it("hands a page that reloads mid-call the grant standing again", () => {
    const w = windows();
    w.draw(w.panel);
    w.relay.showAvatarSession(GRANT);
    w.relay.pageDrew();
    assert.deepEqual(w.panel.sent, [
      { channel: channels.onAvatarSession, payload: GRANT },
      { channel: channels.onAvatarSession, payload: GRANT },
    ]);
  });

  it("hands a page that draws after the session closed nothing", () => {
    const w = windows();
    w.relay.showAvatarSession(GRANT);
    w.relay.showAvatarSession(undefined);
    w.draw(w.panel);
    w.relay.pageDrew();
    assert.deepEqual(w.panel.sent, []);
  });
});
