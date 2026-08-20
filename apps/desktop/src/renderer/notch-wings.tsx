import { CAPSULE_SIDE_WIDTH, PANEL_WIDTH, peekWidth } from "@sidecar/core";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { errandOriginProps } from "./luke-errand";
import { LukeFace } from "./luke-face";
import {
  faceYieldsToMeter,
  speechFaceInputs,
  useFaceHover,
  useFaceMotion,
  usePrefersReducedMotion,
} from "./luke-face-mood";
import { PANEL_PRESENTATION, type PanelPresentation } from "./panel-state";
import { ProviderMark } from "./provider-marks";
import {
  type ProviderTally,
  type SessionTally,
  tallyCaption,
  tallySummary,
  tallyValue,
} from "./session-model";
import {
  LEAVING_ATTRIBUTE,
  useRoster,
  useWingReorderMotion,
  WING_SLOT_ID_ATTRIBUTE,
} from "./session-motion";
import { WAVEFORM_VOICE, Waveform, type WaveformVoice } from "./waveform";

/**
 * The strips beside the camera housing. They are rendered once for both window
 * modes and anchored to the notch rather than to a stage, so growing the window
 * re-lays out nothing here: the face and the count badge stay put, the meter
 * and the captions unfold into the space the expanded panel adds, and the
 * marks — resting against the shape's far edge — glide outward with it on the
 * surface's own spring.
 */
interface NotchWingsProps {
  tally: SessionTally;
  analyser?: AnalyserNode;
  voice?: WaveformVoice;
  /** Reported upward so the turn can end when Luke actually goes quiet. */
  onVoiceActivity?: (active: boolean) => void;
  fixtureSpeaking: boolean;
  hasAudioSignal: boolean;
  /** A pressed talk key still waiting for the call it asked to open. */
  voiceOpening: boolean;
  /** Whether the calendar's quiet is holding announcements — the face sleeps on it. */
  meetingQuiet: boolean;
  /** Whether today's voice allowance is spent with no call open — the face hushes on it. */
  voiceSpent: boolean;
  presentation: PanelPresentation;
  housingWidth: number;
  /**
   * True while sign-in stands between Luke and anything to watch. The strip
   * stays deliberately bare — no face, no count — so the gate in the panel is
   * the one thing introducing him, and a zero that means "not looking yet"
   // SAFETY: The preceding check establishes the asserted contract.
   * never poses as a zero that means "nothing happening".
   */
  accountGated: boolean;
}

/**
 * What one wing costs to fill, in the stylesheet's numbers: `--panel-inset` on
 * the far side, where the marks start level with the tab bar and the rows,
 * `--wing-inset` beside the housing, then the face and its gap, then a first
 * mark and a gap-and-mark for every mark after it.
 */
const WING_INSETS = 29;
const FACE_AND_GAP = 26;
const MARK_WIDTH = 14;
const MARK_AND_GAP = 21;

/**
 * How many marks fit beside the face in a wing of this width. The peek's side
 * is 124px beside the housing it was measured against, which is where its
 * limit of three comes from: the face and its gap cost 26px of the 95px
 * between the wing's insets, and each mark past the first costs 21px of the
 * 55px that remain. The panel's side is what is left of `--panel-width` after
 // SAFETY: The preceding check establishes the asserted contract.
 * the housing, so it holds roughly twice as many.
 */
export function wingMarkCapacity(sideWidth: number): number {
  const beyondFirst = Math.floor(
    (sideWidth - WING_INSETS - FACE_AND_GAP - MARK_WIDTH) / MARK_AND_GAP,
  );
  return Math.max(1, 1 + beyondFirst);
}

/**
 * The peek's side beside this housing: what is left of the floored peek after
 * the housing splits it. Beside the 14-inch housing and anything wider this is
 * the 124px the wing was drawn at; a narrower housing — or the bubble's none —
 * leaves the same floored shape more side to spend.
 */
export function peekSideWidth(housingWidth: number): number {
  return (peekWidth(housingWidth) - housingWidth) / 2;
}

/**
 * What the count badge costs to draw, in the stylesheet's numbers:
 * `--wing-inset` before the number starts, the caption's own margin between
 * the number and its words, and the 0.88 the badge rests at outside the
 * panel. The keep is the last two pixels before the shape's edge, where the
 * black is already turning its corner.
 */
const COUNT_INSET = 9;
const COUNT_CAPTION_GAP = 9;
const COUNT_RESTING_SCALE = 0.88;
const COUNT_EDGE_KEEP = 2;

/**
 * The sign-in label's own margins, in the stylesheet's numbers. It starts at
 * the housing's edge itself — black on black, the notch is indistinguishable
 * from padding, so the inset a numeral keeps buys nothing here — and keeps
 * more from the strip's outer end, where the shape is already turning its
 // SAFETY: The preceding check establishes the asserted contract.
 * corner and words pressed into the curve read as clipped.
 */
const SIGN_IN_INSET = 0;
const SIGN_IN_EDGE_KEEP = 6;

/**
 * How much of its resting scale the count badge keeps so the text never
 * crosses the shape's edge. The number grows with the sessions it counts and
 * the shape beside the housing does not, so past the width the wing can hold
 * the text scales down instead of being drawn onto the desktop. The widths
 * arrive in layout pixels — measured before any transform — so the room is
 * compared against them at the scale the stylesheet is about to apply; the
 * factor multiplies that resting scale rather than replacing it, and is 1
 * whenever the room already suffices. The caption unfolds only in the peek
 * and the panel, so only those states have to fit it; every other state
 * draws the number alone inside the capsule's own side.
 */
export function countBadgeFit(
  presentation: PanelPresentation,
  housingWidth: number,
  valueWidth: number,
  captionWidth: number,
  /** True for the sign-in label, which starts flush at the housing's edge. */
  flushToHousing = false,
): number {
  const captioned =
    presentation === PANEL_PRESENTATION.PEEK || presentation === PANEL_PRESENTATION.PANEL;
  const textWidth = captioned ? valueWidth + COUNT_CAPTION_GAP + captionWidth : valueWidth;
  if (textWidth <= 0) return 1;
  const sideWidth =
    presentation === PANEL_PRESENTATION.PANEL
      ? (PANEL_WIDTH - housingWidth) / 2
      : presentation === PANEL_PRESENTATION.PEEK
        ? peekSideWidth(housingWidth)
        : CAPSULE_SIDE_WIDTH;
  const restingScale = presentation === PANEL_PRESENTATION.PANEL ? 1 : COUNT_RESTING_SCALE;
  const inset = flushToHousing ? SIGN_IN_INSET : COUNT_INSET;
  const keep = flushToHousing ? SIGN_IN_EDGE_KEEP : COUNT_EDGE_KEEP;
  const room = Math.max(0, sideWidth - inset - keep);
  return Math.min(1, room / (restingScale * textWidth));
}

/**
 // SAFETY: The preceding check establishes the asserted contract.
 * The wing's strip, as slots: each provider's mark, then — when the
 * providers outnumber the slots — the count standing in for the rest. The
 // SAFETY: The preceding check establishes the asserted contract.
 * marks are a summary, and a summary that hides its own remainder reads as a
 * complete list, so whatever does not fit is counted rather than dropped. The
 * count is a slot like any other, so it takes the last one rather than being
 * added past the edge of the peek — and it carries a slot id like any other,
 * so a reorder glides it along with the marks instead of teleporting it.
 */
export type WingSlot =
  | { id: string; provider: ProviderTally }
  | { id: typeof OVERFLOW_SLOT_ID; unshown: number };

/**
 * The one slot that is not a provider's, named by the glyph it draws. A mark's
 * slot id is its provider id verbatim, so the count's must be a string no
 * provider id can be — an id is a slug, and a slug never opens with the sign.
 */
export const OVERFLOW_SLOT_ID = "+";

export function wingSlots(
  providers: readonly ProviderTally[],
  capacity: number,
): readonly WingSlot[] {
  const overflowing = providers.length > capacity;
  const shown = providers.slice(0, overflowing ? capacity - 1 : capacity);
  const unshown = providers.length - shown.length;
  const slots: WingSlot[] = shown.map((provider) => ({ id: provider.providerId, provider }));
  if (unshown > 0) slots.push({ id: OVERFLOW_SLOT_ID, unshown });
  return slots;
}

export function NotchWings({
  tally,
  analyser,
  voice,
  onVoiceActivity,
  fixtureSpeaking,
  hasAudioSignal,
  voiceOpening,
  meetingQuiet,
  voiceSpent,
  presentation,
  housingWidth,
  accountGated,
}: NotchWingsProps): React.JSX.Element {
  const [voiceActive, setVoiceActive] = useState(false);
  const reportVoiceActivity = useCallback(
    (active: boolean) => {
      setVoiceActive(active);
      onVoiceActivity?.(active);
    },
    [onVoiceActivity],
  );
  // The meter is the developer's from the press, not from the handshake: while
  // the call is opening it already stands where it will stand once live, so the
  // key answers on the frame it lands rather than when the network does. It
  // also holds through the turn itself rather than following the analyser,
  // which arrives an effect-tick after the turn opens and would blink the
  // meter out for that frame.
  const meterVoice = voice ?? (voiceOpening ? WAVEFORM_VOICE.DEVELOPER : undefined);
  const meterShown = hasAudioSignal || voiceOpening || meterVoice === WAVEFORM_VOICE.DEVELOPER;
  // While the developer holds the turn the meter takes the face's place, which
  // is the only place the capsule has.
  const yieldToMeter = faceYieldsToMeter({
    ...(meterVoice ? { turn: meterVoice } : undefined),
    hasAudioSignal: meterShown,
  });
  // The box the hover is read against, not the face itself: the drawing is
  // remounted for every play, and the hover has to survive the trick it fires.
  const faceElement = useRef<HTMLSpanElement>(null);
  const face = useFaceMotion(
    {
      ...speechFaceInputs({
        ...(voice ? { turn: voice } : undefined),
        hasAudioSignal,
        fixtureSpeaking,
        voiceActive,
      }),
      meetingQuiet,
      voiceSpent,
      attention: tally.attentionIds,
      working: tally.working,
      complete: tally.complete,
      total: tally.total,
    },
    usePrefersReducedMotion(),
    useFaceHover(faceElement),
  );

  // The wing is bounded by the shape its state draws, so its capacity is too:
  // the panel's side holds more marks than the peek's, and every other state
  // keeps the peek's capacity because that is the set the next peek unfolds.
  const capacity =
    presentation === PANEL_PRESENTATION.PANEL
      ? wingMarkCapacity((PANEL_WIDTH - housingWidth) / 2)
      : wingMarkCapacity(peekSideWidth(housingWidth));
  // Memoized because the roster below notices a new list by identity: the
  // slots may only change when what they summarize does, not on every render
  // a spoken word or a face gesture asks for.
  const slots = useMemo(() => wingSlots(tally.providers, capacity), [tally.providers, capacity]);
  // The same treatment the session rows get, along the other axis: a mark
  // found somewhere new glides there, one whose provider left fades in the
  // slot it held — which is also what keeps a capacity that shrinks from
  // unmounting marks mid-fade — and only then does the gap close.
  const marksRef = useWingReorderMotion();
  const drawnSlots = useRoster(slots, marksRef);

  // The count's text, measured in layout pixels: `offsetWidth` never sees the
  // transform about to draw it, so the fit below can divide by the scale the
  // stylesheet applies without measuring its own answer. No dependency list,
  // the way the reorder motion measures — the words change with the tally, and
  // a re-read per commit costs less than proving which commits reworded them —
  // and the guard keeps an unchanged measurement from re-rendering anything.
  const countValueElement = useRef<HTMLSpanElement>(null);
  const countCaptionElement = useRef<HTMLSpanElement>(null);
  const [countWidths, setCountWidths] = useState({ value: 0, caption: 0 });
  useLayoutEffect(() => {
    const value = countValueElement.current?.offsetWidth ?? 0;
    const caption = countCaptionElement.current?.offsetWidth ?? 0;
    setCountWidths((held) =>
      held.value === value && held.caption === caption ? held : { value, caption },
    );
  });
  const countFit = countBadgeFit(
    presentation,
    housingWidth,
    countWidths.value,
    countWidths.caption,
    accountGated,
  );

  return (
    <>
      <div className="wing wing-left" data-audio={String(meterShown)}>
        {/* Ordered so the element nearest the notch is the one the capsule
            keeps: the rest unfold outward and never displace it. */}
        <div className="wing-inner">
          {meterShown ? (
            /* Keyed on whose turn it is, so each voice's meter is a fresh
               mount: the arrival choreography lives in a starting style, and
               only a mount reads one. Luke's turn is what grows the capsule,
               and a meter the developer's turn already had on screen would
               otherwise relocate beside the returning face on the frame the
               turn flips — drawn on the desktop, ahead of an edge still most
               of its travel away. */
            <span className="wing-meter" data-turn={meterVoice} key={meterVoice}>
              <Waveform
                analyser={analyser}
                speaking={fixtureSpeaking}
                voice={meterVoice}
                voiceActive={voiceActive}
                connecting={voiceOpening && !analyser}
                onVoiceActivity={reportVoiceActivity}
              />
            </span>
          ) : (
            <span className="wing-marks" aria-hidden="true" ref={marksRef}>
              {drawnSlots.map(({ item, leaving }) => {
                // How the reorder measurement finds this slot again after a
                // re-sort has moved it, and how a slot whose provider left
                // says so while it fades where the reader last saw it.
                const motion = {
                  [WING_SLOT_ID_ATTRIBUTE]: item.id,
                  [LEAVING_ATTRIBUTE]: String(leaving),
                };
                return "provider" in item ? (
                  <span className="wing-mark" key={item.id} {...motion}>
                    <ProviderMark providerId={item.provider.providerId} />
                  </span>
                ) : (
                  <span className="wing-more" key={item.id} {...motion}>
                    +{item.unshown}
                  </span>
                );
              })}
            </span>
          )}
          {/* Luke himself. He is drawn in every state but one: he steps out of
              the way of your own voice, which is the only thing that displaces
              him. Everything else in the wing is what he is watching.

              Keyed on the play so that each one is a new drawing: a motion plays
              once now, and an element already wearing an animation does not
              replay it on being handed the same one. The wrapper is what the
              hover is measured against, so it holds still across those
              remounts — and hovering it is a moment the face reacts to. */}
          {yieldToMeter || accountGated ? null : (
            /* The wrapper is also where an errand sets off from, for the same
               reason the hover is measured against it: it holds still while a
               motion transforms layers inside the drawing, so a mark peeling
               off it starts exactly where the face is drawn. It is not
               rendered at all while the meter has this place, which is how an
               errand knows there is no face to leave from. */
            <span className="wing-face" ref={faceElement} {...errandOriginProps()}>
              <LukeFace key={face.play} motion={face.motion} repeat={face.repeat} />
            </span>
          )}
        </div>
      </div>

      <div className="wing wing-right">
        <div className="wing-inner">
          {/* While sign-in stands between Luke and anything to watch, the
              badge's place says the one honest thing instead of a zero that
              // SAFETY: The preceding check establishes the asserted contract.
              would pose as "nothing happening": why Luke is idle, and the one
              act that wakes him. It shares the count's element and fit, so it
              // SAFETY: The preceding check establishes the asserted contract.
              scales into the capsule's side exactly as a wide number does. */}
          <span
            className="count-badge"
            // SAFETY: The preceding check establishes the asserted contract.
            style={{ "--count-fit": countFit } as React.CSSProperties}
            data-state={tally.urgency}
            data-empty={String(accountGated || tally.total === 0)}
            data-sign-in={String(accountGated)}
            role="status"
            aria-live="polite"
            aria-label={accountGated ? "Sign in" : tallySummary(tally)}
          >
            <span className="count-value" aria-hidden="true" ref={countValueElement}>
              {accountGated ? "Sign in" : tallyValue(tally)}
            </span>
            <span className="count-caption" aria-hidden="true" ref={countCaptionElement}>
              {/* No caption while signed out: the two words are the label
                  entire, and with nothing beside them the fit keeps their
                  natural size inside the peek's side. */}
              {accountGated ? null : tallyCaption(tally)}
            </span>
          </span>
        </div>
      </div>
    </>
  );
}
