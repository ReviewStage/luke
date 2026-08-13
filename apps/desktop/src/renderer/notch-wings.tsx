import { ProviderMark } from "./provider-marks";
import { type SessionTally, tallyCaption, tallySummary } from "./session-model";
import { Waveform } from "./waveform";

/**
 * The strips beside the camera housing. They are rendered once for both window
 * modes and anchored to the notch rather than to a stage, so growing the window
 * moves nothing here: the count badge and the audio meter stay put and the
 * captions simply unfold into the space the expanded panel adds.
 */
interface NotchWingsProps {
  tally: SessionTally;
  analyser?: AnalyserNode;
  fixtureSpeaking: boolean;
  hasAudioSignal: boolean;
  providerLimit?: number;
}

/**
 * Five marks are what the peek's 124px beside the housing can hold: each one
 * past the first costs 21px of the 115px left once the wing's own inset is
 * taken, and the peek is the narrower of the two states that show them.
 */
const DEFAULT_PROVIDER_LIMIT = 5;

export function NotchWings({
  tally,
  analyser,
  fixtureSpeaking,
  hasAudioSignal,
  providerLimit = DEFAULT_PROVIDER_LIMIT,
}: NotchWingsProps): React.JSX.Element {
  const providers = tally.providers.slice(0, providerLimit);
  // The marks are a summary, and a summary that hides its own remainder reads
  // as a complete list, so whatever does not fit is counted rather than dropped.
  const unshown = tally.providers.length - providers.length;

  return (
    <>
      <div className="wing wing-left" data-audio={String(hasAudioSignal)}>
        {/* Ordered so the element nearest the notch is the one the compact
            capsule keeps: the rest unfold outward and never displace it. */}
        <div className="wing-inner">
          {hasAudioSignal ? (
            <Waveform analyser={analyser} speaking={fixtureSpeaking} />
          ) : (
            <span className="wing-marks" aria-hidden="true">
              {providers.length === 0 ? (
                <span className="wing-marks-empty" />
              ) : (
                providers.map((provider) => (
                  <span className="wing-mark" key={provider.providerId}>
                    <ProviderMark providerId={provider.providerId} />
                  </span>
                ))
              )}
              {unshown > 0 ? <span className="wing-more">+{unshown}</span> : null}
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
