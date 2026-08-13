import { CAPSULE_SIDE_WIDTH, PANEL_WIDTH, PEEK_SIDE_GROWTH } from "@sidecar/core";
import { useEffect, useState } from "react";
import { LukeFace } from "./luke-face";
import { useFaceMotion, usePrefersReducedMotion } from "./luke-face-mood";
import { PANEL_PRESENTATION, type PanelPresentation } from "./panel-state";
import { ProviderMark } from "./provider-marks";
import { type SessionTally, tallyCaption, tallySummary } from "./session-model";
import { WAVEFORM_VOICE, type WaveformVoice, Waveform } from "./waveform";

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
  fixtureSpeaking: boolean;
  hasAudioSignal: boolean;
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
 * `--duration-exit`: the fade the marks leave on. A capacity that shrinks —
 * the panel closing back past the peek — must not unmount marks that are
 * mid-fade, so the smaller set is drawn only once the fade has finished.
 */
const MARK_EXIT_MS = 90;

export function NotchWings({
  tally,
  analyser,
  voice,
  fixtureSpeaking,
  hasAudioSignal,
  presentation,
  housingWidth,
}: NotchWingsProps): React.JSX.Element {
  const [voiceActive, setVoiceActive] = useState(false);
  // Who is talking is known outright once a call is up — the turn says so — and
  // amplitude cannot tell one voice from the other, because the same meter draws
  // Luke answering and the developer asking. It is only consulted when there is
  // no turn to read: a microphone opened from Settings with no call behind it,
  // and the fixture, which has no turn at all.
  //
  // Guarded rather than reset: a microphone that has been closed cannot still be
  // carrying speech, whatever the last frame the meter read said.
  const speaking =
    voice === WAVEFORM_VOICE.LUKE ||
    (voice === undefined && hasAudioSignal && (fixtureSpeaking || voiceActive));
  const face = useFaceMotion(
    {
      speaking,
      // Luke attends while the developer holds the turn, and while a microphone
      // is open without one. It is not attending while it is the one talking.
      microphoneLive: voice === WAVEFORM_VOICE.DEVELOPER || (voice === undefined && hasAudioSignal),
      attention: tally.attentionIds,
      working: tally.working,
      complete: tally.complete,
      total: tally.total,
    },
    usePrefersReducedMotion(),
  );

  // The wing is bounded by the shape its state draws, so its capacity is too:
  // the panel's side holds more marks than the peek's, and every other state
  // keeps the peek's capacity because that is the set the next peek unfolds.
  const capacity =
    presentation === PANEL_PRESENTATION.PANEL
      ? wingMarkCapacity((PANEL_WIDTH - housingWidth) / 2)
      : wingMarkCapacity(PEEK_SIDE_WIDTH);
  const [drawnCapacity, setDrawnCapacity] = useState(capacity);
  // Growing applies in the same render, so the new marks are already mounted
  // when the presentation flips and unfold with everything else. Shrinking
  // waits out the exit fade below.
  if (capacity > drawnCapacity) setDrawnCapacity(capacity);
  useEffect(() => {
    if (capacity >= drawnCapacity) return;
    const timer = window.setTimeout(() => setDrawnCapacity(capacity), MARK_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [capacity, drawnCapacity]);

  // The marks are a summary, and a summary that hides its own remainder reads as
  // a complete list, so whatever does not fit is counted rather than dropped.
  // The count is a slot like any other, so it takes the last one rather than
  // being added past the edge of the peek.
  const overflowing = tally.providers.length > drawnCapacity;
  const providers = tally.providers.slice(0, overflowing ? drawnCapacity - 1 : drawnCapacity);
  const unshown = tally.providers.length - providers.length;

  return (
    <>
      <div className="wing wing-left" data-audio={String(hasAudioSignal)}>
        {/* Ordered so the element nearest the notch is the one the capsule
            keeps: the rest unfold outward and never displace it. */}
        <div className="wing-inner">
          {hasAudioSignal ? (
            <span className="wing-meter">
              <Waveform
                analyser={analyser}
                speaking={fixtureSpeaking}
                voice={voice}
                voiceActive={voiceActive}
                onVoiceActivity={setVoiceActive}
              />
            </span>
          ) : (
            <span className="wing-marks" aria-hidden="true">
              {providers.map((provider) => (
                <span className="wing-mark" key={provider.providerId}>
                  <ProviderMark providerId={provider.providerId} />
                </span>
              ))}
              {unshown > 0 ? <span className="wing-more">+{unshown}</span> : null}
            </span>
          )}
          {/* Luke himself, and the only thing in either wing that is drawn in
              every state. Everything else is what he is watching.

              Keyed on the play so that each one is a new drawing: a motion plays
              once now, and an element already wearing an animation does not
              replay it on being handed the same one. */}
          <LukeFace key={face.play} motion={face.motion} repeat={face.repeat} />
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
