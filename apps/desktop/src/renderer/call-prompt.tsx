import type { CallApp } from "../shared/contracts";
import { CallAppMark } from "./call-app-mark";
import { CALL_PROMPT_MS } from "./panel-state";

/**
 * The panel stood down to one question, asked at the only moment it is cheap to
 * answer: an app has just taken the microphone, and Luke is about to go quiet
 * for it.
 *
 * It is the key slot's shape and the key slot's manners, for a question that
 * arrives rather than one that was asked — which is the whole reason it counts
 * itself down. A panel that appeared unbidden and stayed would be something to
 * dismiss; one that appears, says what it is doing, and leaves is a notice. The
 * bar is what makes the leaving a promise instead of a glitch, so it is drawn
 * even though nothing reads a progress bar: what is being reported is that this
 * ends, not how much of it is left.
 *
 * There is one button, because there is one thing to decide. Doing nothing is
 * the other answer and it is the default — the app counts as a call, which is
 * what the developer switched this on for.
 */
export function CallPrompt({
  app,
  play,
  drawn,
  paused,
  onHoverChange,
  onIgnore,
  measure,
}: {
  /** The app that just took the device, held through the exit so the shape does not blank. */
  app: CallApp | undefined;
  /**
   * Which showing this is. A CSS animation does not start again because the
   * element was handed the animation it is already wearing, so the same app
   * prompting twice — taken off the exemptions and put straight back on the
   * device — would draw a bar that had already run out. The face solves this
   * the same way: a fresh element per play.
   */
  play: number;
  /** True while the prompt is the shape the surface is drawn as. */
  drawn: boolean;
  /** True while the pointer is on it, which is someone reading rather than ignoring. */
  paused: boolean;
  onHoverChange: (hovered: boolean) => void;
  onIgnore: () => void;
  /** Reports the prompt's height, so the surface can end where it does. */
  measure: (element: HTMLElement | null) => void;
}): React.JSX.Element | null {
  if (!app) return null;

  return (
    <div className="call-prompt-stage">
      <div
        className="panel-body call-prompt"
        ref={measure}
        data-hit-region="call-prompt"
        data-paused={String(paused)}
        /* It arrives unasked and reports something, which is what a status
           region is. Not a dialog: nothing here takes the keyboard away or has
           to be answered before anything else can be. */
        role="status"
        aria-label={`${app.name} is using your microphone`}
        /* Reaching for the button is the one thing that must not run the clock
           out. The pointer arriving holds it — both the drawn bar and the
           timer behind it, from one piece of state so they cannot disagree.
           Focus holds it too, or tabbing to the button would be a race against
           the button disappearing. */
        onMouseEnter={() => onHoverChange(true)}
        onMouseLeave={() => onHoverChange(false)}
        onFocusCapture={() => onHoverChange(true)}
        onBlurCapture={() => onHoverChange(false)}
      >
        <p className="call-prompt-title">
          {/* The app's own icon beside its name, the same pair the Settings
              rows draw: it is what makes the app recognisable before the name
              has been read, which matters most in the shape with a clock on
              it. Named rather than described — "an app" would be a thing the
              developer has to go and identify, and the identifying is what
              this shape exists to save. */}
          <CallAppMark app={app} />
          <span>
            <strong>{app.name}</strong> is using your microphone
          </span>
        </p>
        <p className="call-prompt-detail">
          Luke will hold his notices until it stops. They are read out afterwards.
        </p>
        <div className="call-prompt-actions">
          <button
            type="button"
            className="quiet-button"
            /* Disabled once the shape is leaving: the press would land on a
               prompt that has already answered itself, and the app it names is
               only still drawn so the exit does not blank mid-morph. */
            disabled={!drawn}
            onClick={onIgnore}
          >
            Not a call
          </button>
        </div>
        {/* Outside the actions, spanning the shape: it is the shape's own
            deadline rather than any one control's. Keyed on the play so every
            showing draws a fresh element and therefore a fresh drain. */}
        <div
          className="call-prompt-countdown"
          key={play}
          aria-hidden="true"
          style={{ "--call-prompt-ms": `${CALL_PROMPT_MS}ms` } as React.CSSProperties}
        >
          <span className="call-prompt-countdown-fill" />
        </div>
      </div>
    </div>
  );
}
