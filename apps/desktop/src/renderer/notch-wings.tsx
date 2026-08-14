import { CAPSULE_SIDE_WIDTH, PANEL_WIDTH, PEEK_SIDE_GROWTH } from "@sidecar/core";
import { useCallback, useMemo, useRef, useState } from "react";
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
import { type ProviderTally, type SessionTally, tallyCaption, tallySummary } from "./session-model";
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
 * moves nothing here: the face and the count badge stay put and the marks, the
 * meter, and the captions simply unfold into the space the expanded panel adds.
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
  presentation: PanelPresentation;
  housingWidth: number;
}

/**
 * What one wing costs to fill, in the stylesheet's numbers: `--wing-inset` on
 * both sides, then the face and its gap, then a first mark and a gap-and-mark
 * for every mark after it.
 */
const WING_INSETS = 18;
const FACE_AND_GAP = 26;
const MARK_WIDTH = 14;
const MARK_AND_GAP = 21;

/**
 * How many marks fit beside the face in a wing of this width. The peek's side
 * is fixed at 124px whatever the housing measures, which is where the old
 * limit of four came from: the face and its gap cost 26px of the 106px between
 * the wing's insets, and each mark past the first costs 21px of the 80px that
 * remain. The panel's side is what is left of `--panel-width` after the
 * housing, so it holds roughly twice as many.
 */
export function wingMarkCapacity(sideWidth: number): number {
  const beyondFirst = Math.floor(
    (sideWidth - WING_INSETS - FACE_AND_GAP - MARK_WIDTH) / MARK_AND_GAP,
  );
  return Math.max(1, 1 + beyondFirst);
}

const PEEK_SIDE_WIDTH = CAPSULE_SIDE_WIDTH + PEEK_SIDE_GROWTH;

/**
 * The strip beside the face, as slots: each provider's mark, then — when the
 * providers outnumber the slots — the count standing in for the rest. The
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
  presentation,
  housingWidth,
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
    ...(meterVoice ? { turn: meterVoice } : {}),
    hasAudioSignal: meterShown,
  });
  // The box the hover is read against, not the face itself: the drawing is
  // remounted for every play, and the hover has to survive the trick it fires.
  const faceElement = useRef<HTMLSpanElement>(null);
  const face = useFaceMotion(
    {
      ...speechFaceInputs({
        ...(voice ? { turn: voice } : {}),
        hasAudioSignal,
        fixtureSpeaking,
        voiceActive,
      }),
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
      : wingMarkCapacity(PEEK_SIDE_WIDTH);
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

  return (
    <>
      <div className="wing wing-left" data-audio={String(meterShown)}>
        {/* Ordered so the element nearest the notch is the one the capsule
            keeps: the rest unfold outward and never displace it. */}
        <div className="wing-inner">
          {meterShown ? (
            <span className="wing-meter" data-turn={meterVoice}>
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
          {yieldToMeter ? null : (
            <span className="wing-face" ref={faceElement}>
              <LukeFace key={face.play} motion={face.motion} repeat={face.repeat} />
            </span>
          )}
        </div>
      </div>

      <div className="wing wing-right">
        <div className="wing-inner">
          <span
            className="count-badge"
            data-state={tally.state}
            data-empty={String(tally.total === 0)}
            role="status"
            aria-live="polite"
            aria-label={tallySummary(tally)}
          >
            <span className="count-value" aria-hidden="true">
              {tally.total}
            </span>
            <span className="count-caption" aria-hidden="true">
              {tallyCaption(tally)}
            </span>
          </span>
        </div>
      </div>
    </>
  );
}
