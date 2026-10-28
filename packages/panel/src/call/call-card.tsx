/**
 * call-card.tsx -- the standing call as a small card: its task and status, Luke's mark, and its controls.
 *
 * Drawn alone in the floating call window while no Luke window has the
 * keyboard. It carries no words of the conversation, and every press is an
 * act main validates and hands to the voice window, which holds the call.
 */

import { ACT_KIND } from "@luke/host/acts";
import {
  CallBar,
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
} from "@luke/ui";
import type { CallCardModel } from "@luke/ui/call-card-model";
import { VOICE_COMMAND, type VoiceCommand } from "@luke/voice/voice-view";
import type { AnimationEvent } from "react";
import type { ActHandle } from "../act.js";

/** The way back's name, for a reader and its hover: the task it opens. */
function returnLabel(taskName: string): string {
  return `Open ${taskName}`;
}

/** Where a card is drawn, which decides how its title answers and how its controls are hinted. */
export const CALL_CARD_SURFACE = {
  /** At the foot of the column at a Luke window's left, above the tasks' sidebar's account row. */
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

/** Everything a card is drawn from, as a Luke window hands it to wherever it docks. */
export interface CallCardInput {
  card: CallCardModel;
  speakerMuted: boolean;
  controls: CallControls;
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
  const inWindow = surface === CALL_CARD_SURFACE.WINDOW;
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
  return (
    // In the floating window a press on a button acts without taking focus,
    // so the next drag never finds a button holding it.
    <KeepFocus
      as={KEEP_FOCUS_ELEMENT.SECTION}
      scope={inWindow ? KEEP_FOCUS.CONTROLS : KEEP_FOCUS.NONE}
      className="call-card flex flex-col gap-luke-4 rounded-luke-14 border border-border-strong bg-popover px-luke-12 py-luke-8 text-label text-foreground shadow-menu data-[surface=sidebar]:mb-luke-8"
      aria-label="Call"
      data-surface={surface}
      data-leaving={leaving}
      onAnimationEnd={left}
    >
      <div className="call-card-head flex min-w-0 items-center gap-tight-gap">
        <Text
          variant={TEXT_VARIANT.CAPTION}
          tone={TEXT_TONE.MUTED}
          className="call-card-title m-0 min-w-0 flex-1"
        >
          <OneLine>{card.taskName}</OneLine>
        </Text>
        {/* The floating window is too small to hold a tooltip, so there the
            system's own hint names the task the button opens. */}
        {inWindow ? (
          <span className="call-card-return flex" title={returnLabel(card.taskName)}>
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
          microphone={{ muted: card.microphoneMuted, onPress: controls.onToggleMicrophone }}
          speaker={{ muted: speakerMuted, onPress: controls.onToggleSpeaker }}
          onEnd={controls.onEnd}
          titled={inWindow}
        />
      </div>
    </KeepFocus>
  );
}
