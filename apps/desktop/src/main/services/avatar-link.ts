/**
 * avatar-link.ts -- Luke's avatar as the host holds it, bound to the panel and written into the document.
 *
 * The host says where the avatar stands and hands over each grant in process
 * (`HostAvatar`); the panel says whether it played the avatar. Both write
 * `state.voice.avatar`, and the host wins: the panel's word stands only
 * while the host holds a grant, which is the one stretch the panel alone
 * knows more than the host. A grant reaches the panel's page and nothing
 * else here: it is never written, logged, or kept.
 */

import {
  AVATAR_STOP_REASON,
  AVATAR_UNAVAILABLE_REASON,
  type AvatarStopReason,
} from "@luke/features";
import type { ACT_KIND, ActPayload } from "@luke/host/acts";
import type { AppStateStore } from "@luke/host/client";
import type { HostAvatar } from "@luke/host/effect";
import {
  AVATAR_END_REASON,
  AVATAR_OFF,
  AVATAR_STATUS,
  type AvatarEndReason,
  type AvatarState,
} from "@luke/voice/avatar";
import {
  LIVE_AVATAR_END,
  LIVE_AVATAR_STATUS,
  type LiveAvatarEnd,
  type LiveAvatarState,
} from "@luke/voice/live-session";
import { Effect, type Scope, Stream } from "effect";
import type { PanelManager } from "../window/panel-manager";

/** The avatar as the panel reports it. */
export type AvatarReport = ActPayload<typeof ACT_KIND.AVATAR_REPORT>;

/**
 * The panel's ends this side did not start, as the service is told them:
 * Keyframe closed the room, or the session failed. The panel's own
 * close reasons reach the document as these end reasons (`call-avatar.ts`),
 * and this is the one place they go back to the service's vocabulary.
 */
function unstartedStopReason(reason: AvatarEndReason): AvatarStopReason | undefined {
  switch (reason) {
    case AVATAR_END_REASON.SERVER_CLOSED:
      return AVATAR_STOP_REASON.SERVER_CLOSED;
    case AVATAR_END_REASON.ERROR:
      return AVATAR_STOP_REASON.ERROR;
    default:
      return undefined;
  }
}

const END_REASON_OF_STOP = {
  [AVATAR_STOP_REASON.USER]: AVATAR_END_REASON.USER,
  [AVATAR_STOP_REASON.SERVER_CLOSED]: AVATAR_END_REASON.SERVER_CLOSED,
  [AVATAR_STOP_REASON.ERROR]: AVATAR_END_REASON.ERROR,
} as const satisfies Record<AvatarStopReason, AvatarEndReason>;

const END_REASON_OF_UNAVAILABLE = {
  [AVATAR_UNAVAILABLE_REASON.NO_CAPACITY]: AVATAR_END_REASON.NO_CAPACITY,
  [AVATAR_UNAVAILABLE_REASON.NOT_CONFIGURED]: AVATAR_END_REASON.UNAVAILABLE,
  [AVATAR_UNAVAILABLE_REASON.ERROR]: AVATAR_END_REASON.UNAVAILABLE,
} as const;

function endReasonOf(end: LiveAvatarEnd): AvatarEndReason {
  switch (end.by) {
    case LIVE_AVATAR_END.STOPPED:
      return END_REASON_OF_STOP[end.reason];
    case LIVE_AVATAR_END.UNAVAILABLE:
      return END_REASON_OF_UNAVAILABLE[end.reason];
    case LIVE_AVATAR_END.CALL_ENDED:
      return AVATAR_END_REASON.CALL_ENDED;
  }
}

/**
 * The avatar the document holds next, from what it holds now, where the host
 * stands, and the panel's report where one arrived. A host move is written
 * as the host says it, except a grant, which leaves the document to the
 * window that runs it. The panel's report stands only while the host holds
 * a grant, so the panel's own end on a withdrawn grant cannot write
 * over the reason the host withdrew it for.
 */
export function avatarAfter(input: {
  held: AvatarState;
  host: LiveAvatarState;
  report?: AvatarReport;
}): AvatarState {
  const { held, host, report } = input;
  if (report !== undefined) return host.status === LIVE_AVATAR_STATUS.GRANTED ? report : held;
  switch (host.status) {
    case LIVE_AVATAR_STATUS.OFF:
      return AVATAR_OFF;
    case LIVE_AVATAR_STATUS.STARTING:
      return { status: AVATAR_STATUS.STARTING };
    case LIVE_AVATAR_STATUS.GRANTED:
      return held;
    case LIVE_AVATAR_STATUS.ENDED:
      return { status: AVATAR_STATUS.ENDED, endReason: endReasonOf(host.end) };
  }
}

/** The avatar's two doors main's acts reach. */
export interface AvatarLink {
  /** The panel's report, written where the host lets it stand, and a close this side did not start told to the host. */
  report(report: AvatarReport): void;
  /** Video on or off from the tile; off where the host had nothing to stop takes an ended avatar's tile down here. */
  setVideo(on: boolean): Effect.Effect<void>;
}

export interface AvatarLinkDependencies {
  host: HostAvatar;
  state: AppStateStore;
  panel: Pick<PanelManager, "showAvatarSession">;
  /** The host's `voice.setVideo`, over the Gateway. */
  setVideo: (on: boolean) => Effect.Effect<boolean>;
}

/**
 * The link for the launch's scope. Both streams are read from the launch on,
 * because the grants are kept for no subscriber that joins late; the
 * panel's relay keeps the standing grant for a page that draws after it.
 */
export const linkAvatar = Effect.fnUntraced(function* ({
  host,
  state,
  panel,
  setVideo,
}: AvatarLinkDependencies): Effect.fn.Return<AvatarLink, never, Scope.Scope> {
  let standing: LiveAvatarState = { status: LIVE_AVATAR_STATUS.OFF };
  const write = (avatar: AvatarState) => {
    const { voice } = state.snapshot();
    if (voice.avatar.status === avatar.status && voice.avatar.endReason === avatar.endReason) {
      return;
    }
    state.update({ voice: { ...voice, avatar } });
  };
  yield* Effect.forkScoped(
    Stream.runForEach(host.states, (moved) =>
      Effect.sync(() => {
        standing = moved;
        write(avatarAfter({ held: state.snapshot().voice.avatar, host: moved }));
      }),
    ),
  );
  yield* Effect.forkScoped(
    Stream.runForEach(host.grants, (grant) => Effect.sync(() => panel.showAvatarSession(grant))),
  );
  return {
    report: (report) => {
      const granted = standing.status === LIVE_AVATAR_STATUS.GRANTED;
      write(avatarAfter({ held: state.snapshot().voice.avatar, host: standing, report }));
      const unstarted =
        report.status === AVATAR_STATUS.ENDED ? unstartedStopReason(report.endReason) : undefined;
      // Note that the host's own moves follow on its stream: the stop, and the one restart a call has.
      if (granted && unstarted !== undefined) host.closed(unstarted);
    },
    // Note that the host is asked even where the document reads ENDED, because a
    // restart it already began may not have reached the document yet: only its
    // answer that nothing stood to stop lets the tile be taken down here.
    setVideo: (on) =>
      Effect.map(setVideo(on), (requested) => {
        if (on || requested || state.snapshot().voice.avatar.status !== AVATAR_STATUS.ENDED) {
          return;
        }
        write({ status: AVATAR_STATUS.ENDED, endReason: AVATAR_END_REASON.USER });
      }),
  };
});
