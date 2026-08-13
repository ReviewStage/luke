import { useState } from "react";
import { LukeFace } from "./luke-face";
import { useFaceMotion, usePrefersReducedMotion } from "./luke-face-mood";
import { ProviderMark } from "./provider-marks";
import { type SessionTally, tallyCaption, tallySummary } from "./session-model";
import { Waveform } from "./waveform";

/**
 * The strips beside the camera housing. They are rendered once for both window
 * modes and anchored to the notch rather than to a stage, so growing the window
 * moves nothing here: the face and the count badge stay put and the marks, the
 * meter, and the captions simply unfold into the space the expanded panel adds.
 */
interface NotchWingsProps {
  tally: SessionTally;
  analyser?: AnalyserNode;
  fixtureSpeaking: boolean;
  hasAudioSignal: boolean;
  providerLimit?: number;
}

/**
 * Four marks are what the peek holds once the face has taken the place nearest
 * the housing: the face and its gap cost 26px of the 106px between the wing's
 * insets, and each mark past the first costs 21px of the 80px that remain.
 */
const DEFAULT_PROVIDER_LIMIT = 4;

export function NotchWings({
  tally,
  analyser,
  fixtureSpeaking,
  hasAudioSignal,
  providerLimit = DEFAULT_PROVIDER_LIMIT,
}: NotchWingsProps): React.JSX.Element {
  const [voiceActive, setVoiceActive] = useState(false);
  // Guarded rather than reset: a microphone that has been closed cannot still be
  // carrying speech, whatever the last frame the meter read said.
  const speaking = hasAudioSignal && (fixtureSpeaking || voiceActive);
  const motion = useFaceMotion(
    {
      speaking,
      microphoneLive: hasAudioSignal,
      attention: tally.attention,
      working: tally.working,
      complete: tally.complete,
      total: tally.total,
    },
    usePrefersReducedMotion(),
  );

  // The marks are a summary, and a summary that hides its own remainder reads as
  // a complete list, so whatever does not fit is counted rather than dropped.
  // The count is a slot like any other, so it takes the last one rather than
  // being added past the edge of the peek.
  const overflowing = tally.providers.length > providerLimit;
  const providers = tally.providers.slice(0, overflowing ? providerLimit - 1 : providerLimit);
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
              every state. Everything else is what he is watching. */}
          <LukeFace motion={motion} />
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
