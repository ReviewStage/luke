import assert from "node:assert/strict";
import { AVATAR_STOP_REASON, AVATAR_UNAVAILABLE_REASON } from "@luke/features";
import { AVATAR_END_REASON, AVATAR_OFF, AVATAR_STATUS, type AvatarState } from "@luke/voice/avatar";
import {
  LIVE_AVATAR_END,
  LIVE_AVATAR_STATUS,
  type LiveAvatarState,
} from "@luke/voice/live-session";
import { describe, it } from "vitest";
import { avatarAfter } from "./avatar-link";

const LIVE: AvatarState = { status: AVATAR_STATUS.LIVE };
const GRANTED: LiveAvatarState = { status: LIVE_AVATAR_STATUS.GRANTED };
const STARTING: LiveAvatarState = { status: LIVE_AVATAR_STATUS.STARTING };

function ended(end: Extract<LiveAvatarState, { end: unknown }>["end"]): LiveAvatarState {
  return { status: LIVE_AVATAR_STATUS.ENDED, end };
}

describe("the avatar the document holds", () => {
  it("follows the host's every move but a grant, which leaves the window's word standing", () => {
    const moves: [LiveAvatarState, AvatarState][] = [
      [{ status: LIVE_AVATAR_STATUS.OFF }, AVATAR_OFF],
      [STARTING, { status: AVATAR_STATUS.STARTING }],
      [GRANTED, LIVE],
      [
        ended({ by: LIVE_AVATAR_END.UNAVAILABLE, reason: AVATAR_UNAVAILABLE_REASON.NO_CAPACITY }),
        { status: AVATAR_STATUS.ENDED, endReason: AVATAR_END_REASON.NO_CAPACITY },
      ],
      [
        ended({
          by: LIVE_AVATAR_END.UNAVAILABLE,
          reason: AVATAR_UNAVAILABLE_REASON.NOT_CONFIGURED,
        }),
        { status: AVATAR_STATUS.ENDED, endReason: AVATAR_END_REASON.UNAVAILABLE },
      ],
      [
        ended({ by: LIVE_AVATAR_END.UNAVAILABLE, reason: AVATAR_UNAVAILABLE_REASON.ERROR }),
        { status: AVATAR_STATUS.ENDED, endReason: AVATAR_END_REASON.UNAVAILABLE },
      ],
      [
        ended({ by: LIVE_AVATAR_END.STOPPED, reason: AVATAR_STOP_REASON.USER }),
        { status: AVATAR_STATUS.ENDED, endReason: AVATAR_END_REASON.USER },
      ],
      [
        ended({ by: LIVE_AVATAR_END.STOPPED, reason: AVATAR_STOP_REASON.SERVER_CLOSED }),
        { status: AVATAR_STATUS.ENDED, endReason: AVATAR_END_REASON.SERVER_CLOSED },
      ],
      [
        ended({ by: LIVE_AVATAR_END.STOPPED, reason: AVATAR_STOP_REASON.ERROR }),
        { status: AVATAR_STATUS.ENDED, endReason: AVATAR_END_REASON.ERROR },
      ],
      [
        ended({ by: LIVE_AVATAR_END.CALL_ENDED }),
        { status: AVATAR_STATUS.ENDED, endReason: AVATAR_END_REASON.CALL_ENDED },
      ],
    ];
    for (const [host, expected] of moves) {
      assert.deepEqual(avatarAfter({ held: LIVE, host }), expected, JSON.stringify(host));
    }
  });

  it("takes the window's report while the host holds a grant, and only then", () => {
    const report = { status: AVATAR_STATUS.ENDED, endReason: AVATAR_END_REASON.USER } as const;
    assert.deepEqual(avatarAfter({ held: LIVE, host: GRANTED, report }), report);
    for (const host of [STARTING, ended({ by: LIVE_AVATAR_END.CALL_ENDED })]) {
      assert.deepEqual(avatarAfter({ held: LIVE, host, report }), LIVE);
    }
  });
});
