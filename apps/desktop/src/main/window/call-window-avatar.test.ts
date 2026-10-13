import assert from "node:assert/strict";
import type { UnparsedWireValue } from "@sidecar/wire";
import { describe, it } from "vitest";
import { channels } from "#shared/bridge";
import { AVATAR_FEED_KIND, type AvatarGrant } from "#shared/messages/avatar";
import { CallAvatarRelay, type CallWindowPage } from "./call-window-avatar";

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
function page(): CallWindowPage & { sent: Sent[] } {
  const sent: Sent[] = [];
  return { sent, send: (channel, payload) => sent.push({ channel, payload }) };
}

/** The windows main holds during a call: the call window's page, a panel's, and the voice window's. */
function windows() {
  const call = page();
  const panel = page();
  const voice = page();
  let drawn: CallWindowPage | undefined;
  const relay = new CallAvatarRelay(() => drawn);
  return {
    call,
    panel,
    voice,
    relay,
    draw: (next: CallWindowPage | undefined) => {
      drawn = next;
    },
  };
}

describe("the call's avatar relay", () => {
  it("hands the grant to the call window's page and to no other window", () => {
    const w = windows();
    w.draw(w.call);
    w.relay.showAvatarSession(GRANT);
    w.relay.feedAvatar({ kind: AVATAR_FEED_KIND.TURN_END });
    w.relay.showAvatarSession(undefined);
    assert.deepEqual(w.call.sent, [
      { channel: channels.onAvatarSession, payload: GRANT },
      { channel: channels.onAvatarFeed, payload: { kind: AVATAR_FEED_KIND.TURN_END } },
      { channel: channels.onAvatarSession, payload: undefined },
    ]);
    assert.deepEqual(w.panel.sent, []);
    assert.deepEqual(w.voice.sent, []);
  });

  it("hands a page that draws after the grant the grant standing, and the feed it missed not at all", () => {
    const w = windows();
    w.relay.showAvatarSession(GRANT);
    w.relay.feedAvatar({ kind: AVATAR_FEED_KIND.INTERRUPT });
    w.draw(w.call);
    w.relay.pageDrew();
    assert.deepEqual(w.call.sent, [{ channel: channels.onAvatarSession, payload: GRANT }]);
  });

  it("hands a page that draws after the session closed nothing", () => {
    const w = windows();
    w.relay.showAvatarSession(GRANT);
    w.relay.showAvatarSession(undefined);
    w.draw(w.call);
    w.relay.pageDrew();
    assert.deepEqual(w.call.sent, []);
  });
});
