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
import { ReturnIcon } from "@sidecar/panel";
import { type AnimationEvent, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { VOICE_COMMAND, type VoiceCommand } from "#shared/messages/voice-view";
import { type ActHandle, useAct } from "../act";
import { CALL_CONTROL_LABEL, CallBar } from "../planning/planning-parts";
import { Tooltip } from "../tooltip";
import { useAppState } from "../use-app-state";
import { useClipped } from "../use-clipped";
import { useVoiceView } from "../use-voice-view";
import { type CallCardModel, callCard } from "./call-card-model";

/** The way back's name, for a reader and its hover: the plan it opens. */
export function returnLabel(planName: string): string {
  return `Open ${planName}`;
}

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
 * The card as drawn from what it is handed: the call's plan by name, with
 * the way back to it beside the name, over the call bar itself, the same
 * component the plan's own page draws, so its status, its mutes, and its end
 * are the bar's in every word, glyph, and colour, and restyling the bar
 * restyles the card. The way back is a button of its own everywhere, named
 * for the plan it opens. In the floating window the name is the drag handle,
 * since macOS hands a press on a drag region to the drag, never the page.
 * There is no ×: End call is the way to put a call away, and a live call
 * nobody can see is what the card is for.
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
  const name = (
    <span className="call-card-plan" ref={title} data-overflow={clipped}>
      {card.planName}
    </span>
  );
  // The floating window is too small to hold a tooltip, so there the
  // system's own hint names the plan the button opens.
  const returnButton = (
    <button
      type="button"
      className="icon-button"
      aria-label={returnLabel(card.planName)}
      title={inWindow ? returnLabel(card.planName) : undefined}
      onClick={controls.onReturn}
    >
      <ReturnIcon />
    </button>
  );
  const left = (event: AnimationEvent<HTMLElement>) => {
    if (leaving && event.target === event.currentTarget) onLeft?.();
  };
  return (
    <section
      className="call-card"
      aria-label="Call"
      data-surface={surface}
      data-leaving={leaving}
      onAnimationEnd={left}
    >
      <div className="call-card-head">
        <p className="call-card-title">{name}</p>
        {inWindow ? (
          returnButton
        ) : (
          <Tooltip label={returnLabel(card.planName)}>{returnButton}</Tooltip>
        )}
      </div>
      {/* A block of its own, as the plan's page holds it, so the bar spans the card. */}
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
