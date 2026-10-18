/**
 * call-card.tsx -- the standing call as a small card: its task and status, Luke's mark, and its controls.
 *
 * One card, drawn in whichever one place the call is not otherwise on
 * screen: at the foot of the column standing at a Luke window's left while
 * that window shows anything but the call's task, the tasks' sidebar,
 * Settings' page list, and a version history's versions alike, floating in
 * the window's bottom-left corner while the tasks' sidebar is folded, and
 * alone in the floating window while no Luke window has the keyboard. It
 * carries no words of the conversation, and every press is an act main
 * validates and hands to the voice window, which holds the call.
 */

import { ACT_KIND } from "@luke/host/acts";
import type { ActHandle } from "@luke/panel/act";
import { useAppState, useExperiment } from "@luke/panel/use-app-state";
import { EXPERIMENT } from "@luke/settings";
import { IconButton, ReturnIcon } from "@luke/ui";
import { type CallCardModel, callCardVideoStatus } from "@luke/ui/call-card-model";
import { useClipped } from "@luke/ui/use-clipped";
import { AVATAR_OFF, AVATAR_STATUS, type AvatarStatus } from "@luke/voice/avatar";
import { VOICE_COMMAND, type VoiceCommand } from "@luke/voice/voice-view";
import { type AnimationEvent, type MouseEvent, type ReactNode, useRef, useState } from "react";
import { CALL_CONTROL_LABEL, CallBar } from "../tasks/tasks-parts";
import { Tooltip } from "../tooltip";
import { useVoiceView } from "../use-voice-view";
import { CallVideoTile, VideoToggle } from "./call-video-tile";

/** The way back's name, for a reader and its hover: the task it opens. */
function returnLabel(taskName: string): string {
  return `Open ${taskName}`;
}

/** Where a card is drawn, which decides how its title answers and how its controls are hinted. */
export const CALL_CARD_SURFACE = {
  /** At the foot of the column at a Luke window's left, above the tasks' sidebar's account row (`ColumnFoot`). */
  SIDEBAR: "sidebar",
  /** In a Luke window's bottom-left corner, while the tasks' sidebar is folded. */
  FLOATING: "floating",
  /** Alone in the floating window, over whatever app is in front. */
  WINDOW: "window",
} as const;

type CallCardSurface = (typeof CALL_CARD_SURFACE)[keyof typeof CALL_CARD_SURFACE];

/** The card's presses. */
export interface CallControls {
  onReturn: () => void;
  onToggleMicrophone: () => void;
  onToggleSpeaker: () => void;
  onEnd: () => void;
}

/**
 * The avatar as a card draws it (`callCardVideoStatus`): its tile while it
 * is starting or live, playing the track handed, and Video on beside the
 * plan's name while it is `OFF`. Video off and Video on ask main, as the
 * Call tab's do, so one press turns video off or on in every view at once.
 */
export interface CallCardVideo {
  status: AvatarStatus;
  /** The avatar's video, or nothing yet, which the tile draws as Luke's still face. */
  track: MediaStreamTrack | undefined;
  onSetVideo: (on: boolean) => void;
}

/** Everything a card is drawn from, as a Luke window hands it to wherever it docks. */
export interface CallCardInput {
  card: CallCardModel;
  speakerMuted: boolean;
  controls: CallControls;
  /** Absent on a call with no video to offer, which draws the card alone. */
  video?: CallCardVideo | undefined;
}

/** What a card draws of the avatar on this window's document (`callCardVideoStatus`). */
export function useCardVideoStatus(): AvatarStatus | undefined {
  const state = useAppState();
  const { view } = useVoiceView();
  const videoCalls = useExperiment(EXPERIMENT.VIDEO_CALLS);
  return callCardVideoStatus({ view, avatar: state?.voice.avatar ?? AVATAR_OFF, videoCalls });
}

/**
 * The card's video from its status and the track the window holds for it,
 * its Video off and Video on asking main as the Call tab's do, or nothing
 * while the card has no video to offer.
 */
export function cardVideo(
  status: AvatarStatus | undefined,
  track: MediaStreamTrack | undefined,
  tell: ActHandle["tell"],
): CallCardVideo | undefined {
  if (status === undefined) return undefined;
  return { status, track, onSetVideo: (on) => tell(ACT_KIND.VOICE_SET_VIDEO, { on }) };
}

/**
 * Each press as the act it is: the way back is main's to answer on the call's
 * own task, and the three call controls are the voice window's, about the
 * call standing, so none of them names a task.
 */
export function callControls(tell: ActHandle["tell"], speakerMuted: boolean): CallControls {
  const command = (sent: VoiceCommand) => tell(ACT_KIND.VOICE_COMMAND, { command: sent });
  return {
    onReturn: () => tell(ACT_KIND.CALL_SHOW_TASK),
    onToggleMicrophone: () => command(VOICE_COMMAND.TOGGLE_MICROPHONE),
    onToggleSpeaker: () =>
      command(speakerMuted ? VOICE_COMMAND.UNMUTE_SPEAKER : VOICE_COMMAND.MUTE_SPEAKER),
    onEnd: () => command(VOICE_COMMAND.END_CALL),
  };
}

/**
 * The card as drawn from what it is handed: the call's task by name, with
 * the way back to it beside the name, over the call bar itself, the same
 * component the task's own page draws, so its status, its mutes, and its end
 * are the bar's in every word, glyph, and colour, and restyling the bar
 * restyles the card. The way back is a button of its own everywhere, named
 * for the task it opens. In the floating window the name is the drag handle,
 * since macOS hands a press on a drag region to the drag, never the page.
 * There is no ×: End call is the way to put a call away, and a live call
 * nobody can see is what the card is for. On a video call the Call tab's
 * own tile stands over the name while the avatar does, with its Video off
 * and no end of its own, and Video on stands beside the name once it is down.
 */
export function CallCard({
  card,
  speakerMuted,
  controls,
  video,
  surface,
  leaving = false,
  onLeft,
}: CallCardInput & {
  surface: CallCardSurface;
  /** Whether the card is on its way out, which it slides through before it is gone. */
  leaving?: boolean;
  onLeft?: () => void;
}): React.JSX.Element {
  const [title, clipped] = useClipped();
  const inWindow = surface === CALL_CARD_SURFACE.WINDOW;
  const name = (
    <span className="call-card-task" ref={title} data-overflow={clipped}>
      {card.taskName}
    </span>
  );
  const returnButton = (
    <IconButton
      icon={<ReturnIcon />}
      label={returnLabel(card.taskName)}
      onClick={controls.onReturn}
    />
  );
  // In the floating window a press on a button acts without taking focus,
  // so the next drag never finds a button holding it.
  const keepFocus = (event: MouseEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest("button")) event.preventDefault();
  };
  const left = (event: AnimationEvent<HTMLElement>) => {
    if (leaving && event.target === event.currentTarget) onLeft?.();
  };
  const tiled = video !== undefined && video.status !== AVATAR_STATUS.OFF;
  return (
    <section
      className="call-card"
      aria-label="Call"
      data-surface={surface}
      data-leaving={leaving}
      onAnimationEnd={left}
      onMouseDown={inWindow ? keepFocus : undefined}
    >
      {tiled ? (
        <CallVideoTile video={video.track} status={video.status} onSetVideo={video.onSetVideo} />
      ) : null}
      <div className="call-card-head">
        <p className="call-card-title">{name}</p>
        {video?.status === AVATAR_STATUS.OFF ? (
          <VideoToggle on={false} onSetVideo={video.onSetVideo} />
        ) : null}
        {/* The floating window is too small to hold a tooltip, so there the
            system's own hint names the task the button opens. */}
        {inWindow ? (
          <span className="call-card-return" title={returnLabel(card.taskName)}>
            {returnButton}
          </span>
        ) : (
          <Tooltip label={returnLabel(card.taskName)}>{returnButton}</Tooltip>
        )}
      </div>
      {/* A block of its own, as the task's page holds it, so the bar spans the card. */}
      <div>
        <CallBar
          status={card.status}
          microphone={{
            label: CALL_CONTROL_LABEL.MUTE_MICROPHONE,
            enabled: true,
            muted: card.microphoneMuted,
            onPress: controls.onToggleMicrophone,
          }}
          speaker={{ muted: speakerMuted, onPress: controls.onToggleSpeaker }}
          stop={{ shown: true, onPress: controls.onEnd }}
          titled={inWindow}
        />
      </div>
    </section>
  );
}

/**
 * A Luke window's card, docked where the window puts it: drawn while it is
 * handed one, and kept through its slide out once it is not, from the last
 * call it was handed, until that slide has ended.
 */
export function CallCardDock({
  call,
  surface,
}: {
  call: CallCardInput | undefined;
  surface: CallCardSurface;
}): React.JSX.Element | null {
  const last = useRef(call);
  if (call !== undefined) last.current = call;
  const [gone, setGone] = useState(call === undefined);
  if (call !== undefined && gone) setGone(false);
  const drawn = call ?? (gone ? undefined : last.current);
  if (drawn === undefined) return null;
  return (
    <CallCard
      {...drawn}
      surface={surface}
      leaving={call === undefined}
      onLeft={() => setGone(true)}
    />
  );
}

/**
 * The foot of the column standing at a Luke window's left, wherever the
 * window stands: the tasks' sidebar, Settings' page list, or a version
 * history's versions, a plan's or the plan template's. Every one of them
 * docks the card here, above whatever the column keeps at its foot, so the
 * card is in the same place on every page and never stands over the
 * column's own rows. Only the tasks' sidebar folds, so only it hands the
 * card to the window's corner (`desktop-shell.tsx`).
 */
export function ColumnFoot({
  call,
  children,
}: {
  call: CallCardInput | undefined;
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="sidebar-foot">
      <CallCardDock call={call} surface={CALL_CARD_SURFACE.SIDEBAR} />
      {children}
    </div>
  );
}
