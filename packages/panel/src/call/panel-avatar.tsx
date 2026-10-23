/**
 * panel-avatar.tsx -- Luke's avatar as the panel draws it: his voice from the panel's root, and his video centred above the composer of the call's own agent's tab and on the call card.
 *
 * The panel runs the avatar's session (`call-avatar.ts`) for as long as main
 * hands it a grant, whichever tab it shows and while it is hidden, because
 * the avatar's voice is what the developer hears: the voice window's own
 * element is muted while the avatar plays. So the voice is played from the
 * panel's root, and only the video is drawn in the tab of the agent the call
 * speaks into, and on the call card wherever the window docks it.
 * Both draw the one track the session published, each on an element of its
 * own, so a second view costs no second subscription and never drifts from
 * the first. Only the gates are here, in the bundle every window parses:
 * the session and what draws it are chunks of their own, read only while
 * the Video calls experiment is on (`video-calls.tsx`).
 */

import { useAtomValue } from "@effect/atom-react/Hooks";
import { ACT_KIND } from "@luke/host/acts";
import { EXPERIMENT } from "@luke/settings";
import { agentCallVideoStatus } from "@luke/ui/call-card-model";
import { AVATAR_END_REASON, AVATAR_STATUS, type AvatarStatus } from "@luke/voice/avatar";
import { Effect, Option, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import { Suspense, useMemo } from "react";
import { tellAct, useAct } from "../act.js";
import { type BundleImporter, callAvatarBundleAtom, importCallAvatar } from "../bundle-loader.js";
import { AGENT_CALL_VIDEO, AVATAR_VOICE } from "../experiments-on-demand.js";
import { rendererRuntime } from "../renderer-runtime.js";
import { experimentAtom, useExperiment } from "../use-app-state.js";
import { useStandingVoiceView, useVoiceAvatar } from "../use-voice-view.js";
import { avatarGrantAtom, type CallAvatarTracks, NO_AVATAR_TRACKS } from "./avatar-grant.js";
import { type CallCardVideo, cardVideo, useCardVideoStatus } from "./call-card.js";

/** What main is told of a grant whose avatar's code could not be read: ended in error, as a session that cannot open is (`call-avatar.ts`). */
const UNLOADED_REPORT = {
  status: AVATAR_STATUS.ENDED,
  endReason: AVATAR_END_REASON.ERROR,
} as const;

/**
 * The avatar's tracks as published so far, none before a session stands,
 * and none while the Video calls experiment is off: only then is the
 * avatar's code read (`bundle`, `bundle-loader.ts`'s `callAvatarBundleAtom`)
 * and its session run over the grant main hands (`avatar-grant.ts`), which
 * is listened to whatever the experiment, because main hands the standing
 * one only once, as the page first draws.
 *
 * Where the code could not be read, every grant main hands reads it again
 * (`reread`), and is reported ended in error where it still cannot be, so
 * main never waits on a session that will not start; once it is read, the
 * bundle is read afresh and the session starts on the grant standing. Note
 * that the bundle is read afresh only once its code has landed, because a
 * read that failed again would put this stand-in down and up again, and it
 * would read the standing grant again.
 */
export function panelAvatarOf(
  bundle: Atom.Atom<
    AsyncResult.AsyncResult<Atom.Atom<AsyncResult.AsyncResult<CallAvatarTracks, unknown>>, Error>
  >,
  reread: BundleImporter<unknown>,
): Atom.Atom<CallAvatarTracks> {
  const unloaded = rendererRuntime.atom((get) =>
    get.streamResult(avatarGrantAtom).pipe(
      Stream.orDie,
      // Main may hand the same grant twice, which is still the one read.
      Stream.changesWith((held, next) => held?.participantToken === next?.participantToken),
      // Note that each grant, or its withdrawal, interrupts the read the last
      // one started, because main applies a report to the grant standing, and
      // a late failure would end a newer avatar.
      Stream.switchMap((grant) =>
        grant === undefined
          ? Stream.empty
          : Stream.fromEffect(
              Effect.tryPromise(reread).pipe(
                Effect.match({
                  onFailure: () => tellAct(ACT_KIND.AVATAR_REPORT, UNLOADED_REPORT),
                  onSuccess: () => get.refresh(bundle),
                }),
              ),
            ),
      ),
      Stream.runDrain,
    ),
  );
  return Atom.make((get) => {
    get.mount(avatarGrantAtom);
    if (!get(experimentAtom(EXPERIMENT.VIDEO_CALLS))) return NO_AVATAR_TRACKS;
    const loaded = get(bundle);
    if (AsyncResult.isFailure(loaded)) get.mount(unloaded);
    if (!AsyncResult.isSuccess(loaded)) return NO_AVATAR_TRACKS;
    return Option.getOrElse(AsyncResult.value(get(loaded.value)), () => NO_AVATAR_TRACKS);
  });
}

/** The avatar the renderer's root mounts before anything is drawn, so the grant is never missed and the avatar runs whatever tab is shown and while the panel is hidden. */
export const panelAvatarAtom = panelAvatarOf(callAvatarBundleAtom, importCallAvatar);

/** The avatar's tracks as published so far, none before a session stands. */
function useAvatarTracks(): CallAvatarTracks {
  return useAtomValue(panelAvatarAtom);
}

/**
 * The avatar's voice, mounted once at the panel's root and played for as
 * long as its track stands (`video-calls.tsx`), drawn only while the Video
 * calls experiment is on, so its code is read only then.
 */
export function PanelAvatarVoice(): React.JSX.Element | null {
  if (!useExperiment(EXPERIMENT.VIDEO_CALLS)) return null;
  return (
    <Suspense fallback={null}>
      <AVATAR_VOICE.Route />
    </Suspense>
  );
}

/** What an agent's tab draws of the avatar, and the door its Video on and off asks through. */
export interface AgentCallVideoState {
  /** The avatar's status on a call into the agent, `OFF` once video is down, and none where no video is offered. */
  status: AvatarStatus | undefined;
  video: MediaStreamTrack | undefined;
  /** Asks main to put the avatar up again, a fresh session, or take it down. */
  onSetVideo: (on: boolean) => void;
}

/**
 * The avatar on a call into one agent: offered while that call is in
 * progress and the Video calls experiment is on, or while an avatar still
 * stands. Video off, Video on, and Restart video ask main to take the
 * avatar down or put it up again on the call standing.
 */
export function useAgentCallVideo(agentId: string): AgentCallVideoState {
  const { tell } = useAct();
  const view = useStandingVoiceView();
  const avatar = useVoiceAvatar();
  const videoCalls = useExperiment(EXPERIMENT.VIDEO_CALLS);
  return {
    status: agentCallVideoStatus({ view, avatar, agentId, videoCalls }),
    video: useAvatarTracks().video,
    onSetVideo: (on) => tell(ACT_KIND.VOICE_SET_VIDEO, { on }),
  };
}

/**
 * Luke's video while a call into one agent stands, in its own room between
 * the agent's transcript and its composer (`video-calls.tsx`), its code read
 * the first time there is a video to draw. Nothing at all once video is off,
 * so the room goes with it.
 */
export function AgentCallVideo({ agentId }: { agentId: string }): React.JSX.Element | null {
  const { status } = useAgentCallVideo(agentId);
  if (status === undefined || status === AVATAR_STATUS.OFF) return null;
  return (
    <Suspense fallback={null}>
      <AGENT_CALL_VIDEO.Route agentId={agentId} />
    </Suspense>
  );
}

/**
 * The avatar as the panel's call card draws it, on the same track, status,
 * and toggle as the agent's tab, or nothing while the card has no video to
 * offer.
 */
export function useCallCardVideo(): CallCardVideo | undefined {
  const { tell } = useAct();
  const status = useCardVideoStatus();
  const track = useAvatarTracks().video;
  return useMemo(() => cardVideo(status, track, tell), [status, track, tell]);
}
