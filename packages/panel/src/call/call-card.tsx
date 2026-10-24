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
import { EXPERIMENT } from "@luke/settings";
import {
  CALL_VIDEO_FIT,
  CallBar,
  CallVideoTile,
  IconButton,
  KEEP_FOCUS,
  KEEP_FOCUS_ELEMENT,
  KeepFocus,
  OneLine,
  ReturnIcon,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  Tooltip,
  VideoToggle,
} from "@luke/ui";
import { type CallCardModel, callCardVideoStatus } from "@luke/ui/call-card-model";
import { AVATAR_STATUS, type AvatarStatus } from "@luke/voice/avatar";
import { VOICE_COMMAND, type VoiceCommand } from "@luke/voice/voice-view";
import {
  type AnimationEvent,
  createContext,
  type ReactNode,
  useContext,
  useRef,
  useState,
} from "react";
import type { ActHandle } from "../act.js";
import { useExperiment } from "../use-app-state.js";
import { useMicrophoneGranted, useStandingVoiceView, useVoiceAvatar } from "../use-voice-view.js";

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
 * agent's tab's do, so one press turns video off or on in every view at once.
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
  const view = useStandingVoiceView();
  const avatar = useVoiceAvatar();
  const videoCalls = useExperiment(EXPERIMENT.VIDEO_CALLS);
  return callCardVideoStatus({ view, avatar, videoCalls });
}

/**
 * The card's video from its status and the track the window holds for it,
 * its Video off and Video on asking main as the agent's tab's do, or nothing
 * while the card has no video to offer.
 */
export function cardVideo(
  status: AvatarStatus | undefined,
  track: MediaStreamTrack | undefined,
  press: ActHandle["press"],
): CallCardVideo | undefined {
  if (status === undefined) return undefined;
  return { status, track, onSetVideo: (on) => press(ACT_KIND.VOICE_SET_VIDEO, { on }) };
}

/**
 * Each press as the act it is: the way back is main's to answer on the call's
 * own task, and the three call controls are the voice window's, about the
 * call standing, so none of them names a task.
 */
export function callControls(press: ActHandle["press"], speakerMuted: boolean): CallControls {
  const command = (sent: VoiceCommand) => press(ACT_KIND.VOICE_COMMAND, { command: sent });
  return {
    onReturn: () => press(ACT_KIND.CALL_SHOW_AGENT),
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
 * nobody can see is what the card is for. On a video call the agent's
 * tab's own tile stands over the name while the avatar does, with its Video off
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
  const inWindow = surface === CALL_CARD_SURFACE.WINDOW;
  const microphoneGranted = useMicrophoneGranted();
  const returnButton = (
    <IconButton
      icon={<ReturnIcon />}
      label={returnLabel(card.taskName)}
      onClick={controls.onReturn}
    />
  );
  const left = (event: AnimationEvent<HTMLElement>) => {
    if (leaving && event.target === event.currentTarget) onLeft?.();
  };
  const tiled = video !== undefined && video.status !== AVATAR_STATUS.OFF;
  return (
    // In the floating window a press on a button acts without taking focus,
    // so the next drag never finds a button holding it.
    <KeepFocus
      as={KEEP_FOCUS_ELEMENT.SECTION}
      scope={inWindow ? KEEP_FOCUS.CONTROLS : KEEP_FOCUS.NONE}
      className="call-card"
      aria-label="Call"
      data-surface={surface}
      data-leaving={leaving}
      onAnimationEnd={left}
    >
      {tiled ? (
        <CallVideoTile
          video={video.track}
          status={video.status}
          fit={CALL_VIDEO_FIT.CARD}
          onSetVideo={video.onSetVideo}
        />
      ) : null}
      <div className="call-card-head">
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} className="call-card-title">
          <OneLine>{card.taskName}</OneLine>
        </Text>
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
            muted: card.microphoneMuted,
            offered: microphoneGranted,
            onPress: controls.onToggleMicrophone,
          }}
          speaker={{ muted: speakerMuted, onPress: controls.onToggleSpeaker }}
          onEnd={controls.onEnd}
          titled={inWindow}
        />
      </div>
    </KeepFocus>
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
 * The card this window draws, while it draws one, handed down from the
 * window's root (`StandingCallCard`, `panel-avatar.tsx`) past every page
 * between, so the card's every change of status draws its docks alone and
 * not the pages they stand in.
 */
export const CallCardContext = createContext<CallCardInput | undefined>(undefined);

/** The window's card, docked here while `docked`, and slid out once it is not (`CallCardDock`). */
export function StandingCallCardDock({
  docked,
  surface,
}: {
  docked: boolean;
  surface: CallCardSurface;
}): React.JSX.Element | null {
  const call = useContext(CallCardContext);
  return <CallCardDock call={docked ? call : undefined} surface={surface} />;
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
  docked = true,
  children,
}: {
  /** Whether the window's card docks here; the tasks' sidebar hands it to the window's corner while folded. */
  docked?: boolean;
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="sidebar-foot">
      <StandingCallCardDock docked={docked} surface={CALL_CARD_SURFACE.SIDEBAR} />
      {children}
    </div>
  );
}
