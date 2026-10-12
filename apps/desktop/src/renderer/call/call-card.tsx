/**
 * call-card.tsx -- the standing call as a small card: its plan and status, Luke's mark, and its controls.
 *
 * One card, drawn in whichever one place the call is not otherwise on
 * screen: at the foot of a Luke window's sidebar while that window shows
 * anything but the call's plan, floating in the window's bottom-left corner
 * while the sidebar is folded, and alone in the floating window while no
 * Luke window has the keyboard. It carries no words of the conversation, and
 * every press is an act main validates and hands to the voice window, which
 * holds the call.
 */

import { IDLE_PLANNING_VIEW } from "@sidecar/hosted/planning-view";
import {
  CloseIcon,
  ExternalIcon,
  MicrophoneIcon,
  MicrophoneOffIcon,
  SpeakerIcon,
  SpeakerOffIcon,
  WingFace,
} from "@sidecar/panel";
import { type AnimationEvent, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { VOICE_COMMAND, type VoiceCommand } from "#shared/messages/voice-view";
import { APP_COMMAND, type KeyedCommand } from "#shared/shortcuts";
import { type ActHandle, useAct } from "../act";
import { speechFaceInputs, useFaceMotion } from "../luke-face-mood";
import { CALL_CONTROL_LABEL } from "../planning/planning-parts";
import { Tooltip } from "../tooltip";
import { useAppState } from "../use-app-state";
import { useClipped } from "../use-clipped";
import { usePrefersReducedMotion } from "../use-reduced-motion";
import { useVoiceView } from "../use-voice-view";
import { CALL_CARD_TONE, type CallCardModel, callCard } from "./call-card-model";

/** The way back's name, for a reader and its hover. */
export const RETURN_TO_PLAN_LABEL = "Return to the plan";

/** Where a card is drawn, which decides how its title answers and how its controls are hinted. */
export const CALL_CARD_SURFACE = {
  /** At the foot of a Luke window's sidebar, above the account row. */
  SIDEBAR: "sidebar",
  /** In a Luke window's bottom-left corner, while its sidebar is folded. */
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

/** Everything a card is drawn from, as a Luke window hands it to wherever it docks. */
export interface CallCardInput {
  card: CallCardModel;
  speakerMuted: boolean;
  controls: CallControls;
}

/**
 * Each press as the act it is: the way back is main's to answer on the call's
 * own plan, and the three call controls are the voice window's, about the
 * call standing, so none of them names a plan.
 */
export function callControls(tell: ActHandle["tell"], speakerMuted: boolean): CallControls {
  const command = (sent: VoiceCommand) => tell(ACT_KIND.VOICE_COMMAND, { command: sent });
  return {
    onReturn: () => tell(ACT_KIND.CALL_SHOW_PLAN),
    onToggleMicrophone: () => command(VOICE_COMMAND.TOGGLE_MICROPHONE),
    onToggleSpeaker: () =>
      command(speakerMuted ? VOICE_COMMAND.UNMUTE_SPEAKER : VOICE_COMMAND.MUTE_SPEAKER),
    onEnd: () => command(VOICE_COMMAND.END_CALL),
  };
}

/**
 * One of the card's buttons, in the call bar's own classes. In a Luke window
 * it is hinted by the app's tooltip, chord and all; the floating window is
 * too small to hold a tooltip, so there the system's own hint names it.
 */
function CardButton({
  label,
  className,
  surface,
  pressed,
  command,
  onPress,
  children,
}: {
  label: string;
  className: string;
  surface: CallCardSurface;
  pressed?: boolean;
  command?: KeyedCommand;
  onPress: () => void;
  children: React.JSX.Element;
}): React.JSX.Element {
  const inWindow = surface === CALL_CARD_SURFACE.WINDOW;
  const button = (
    <button
      type="button"
      className={className}
      aria-label={label}
      aria-pressed={pressed}
      title={inWindow ? label : undefined}
      onClick={onPress}
    >
      {children}
    </button>
  );
  if (inWindow) return button;
  return (
    <Tooltip label={label} {...(command ? { command } : undefined)}>
      {button}
    </Tooltip>
  );
}

/** Luke's mark where a player draws its source's: his face, ringed in the colour of whose turn it is. */
function CallMark({ card }: { card: CallCardModel }): React.JSX.Element {
  const face = useFaceMotion(
    speechFaceInputs({
      lukeSpeaking: card.status.tone === CALL_CARD_TONE.LUKE,
      listening: card.status.tone === CALL_CARD_TONE.DEVELOPER,
    }),
    usePrefersReducedMotion(),
  );
  return (
    <span className="call-card-mark" aria-hidden="true">
      <WingFace key={face.play} motion={face.motion} repeat={face.repeat} />
    </span>
  );
}

/**
 * The card as drawn from what it is handed. Its first line is the call's
 * plan and status, which is the way back in a Luke window and the drag
 * handle in the floating window, where the way back is a button of its own
 * instead: macOS hands a press on a drag region to the drag, never the page.
 * Its second is Luke's mark and the controls, evenly spaced as a player's.
 * There is no ×: End call is the way to put a call away, and a live call
 * nobody can see is exactly what the card is for.
 */
export function CallCard({
  card,
  speakerMuted,
  controls,
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
  const words = (
    <span className="call-card-words" ref={title} data-overflow={clipped}>
      <span className="call-card-plan">{card.planName}</span>
      <span className="call-card-status" role="status">
        {" · "}
        {card.status.words}
      </span>
    </span>
  );
  const left = (event: AnimationEvent<HTMLElement>) => {
    if (leaving && event.target === event.currentTarget) onLeft?.();
  };
  return (
    <section
      className="call-card"
      aria-label="Call"
      data-surface={surface}
      data-tone={card.status.tone}
      data-leaving={leaving}
      onAnimationEnd={left}
    >
      {inWindow ? (
        <p className="call-card-title">{words}</p>
      ) : (
        <Tooltip label={RETURN_TO_PLAN_LABEL}>
          <button type="button" className="call-card-title" onClick={controls.onReturn}>
            {words}
          </button>
        </Tooltip>
      )}
      <div className="call-card-controls">
        <CallMark card={card} />
        <CardButton
          label={
            card.microphoneMuted
              ? CALL_CONTROL_LABEL.UNMUTE_MICROPHONE
              : CALL_CONTROL_LABEL.MUTE_MICROPHONE
          }
          className="icon-button call-toggle"
          surface={surface}
          pressed={card.microphoneMuted}
          command={APP_COMMAND.TOGGLE_MICROPHONE}
          onPress={controls.onToggleMicrophone}
        >
          {card.microphoneMuted ? <MicrophoneOffIcon /> : <MicrophoneIcon />}
        </CardButton>
        <CardButton
          label={speakerMuted ? CALL_CONTROL_LABEL.UNMUTE_SPEAKER : CALL_CONTROL_LABEL.MUTE_SPEAKER}
          className="icon-button call-toggle"
          surface={surface}
          pressed={speakerMuted}
          command={APP_COMMAND.TOGGLE_SPEAKER}
          onPress={controls.onToggleSpeaker}
        >
          {speakerMuted ? <SpeakerOffIcon /> : <SpeakerIcon />}
        </CardButton>
        {inWindow ? (
          <CardButton
            label={RETURN_TO_PLAN_LABEL}
            className="icon-button"
            surface={surface}
            onPress={controls.onReturn}
          >
            <ExternalIcon />
          </CardButton>
        ) : null}
        <CardButton
          label={CALL_CONTROL_LABEL.END_CALL}
          className="call-end"
          surface={surface}
          onPress={controls.onEnd}
        >
          <CloseIcon />
        </CardButton>
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

/** The floating window's root: the card over the document it is handed. */
export function CallWindowCard(): React.JSX.Element {
  const { tell } = useAct();
  const state = useAppState();
  const { view } = useVoiceView();
  return (
    <CallCard
      card={callCard({ view, planning: state?.planning ?? IDLE_PLANNING_VIEW })}
      speakerMuted={view.speakerMuted}
      controls={callControls(tell, view.speakerMuted)}
      surface={CALL_CARD_SURFACE.WINDOW}
    />
  );
}
