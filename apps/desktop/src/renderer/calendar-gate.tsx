import { GOOGLE_CALENDAR_ID } from "@sidecar/calendar/vocabulary";
import { ProviderMark } from "@sidecar/panel";
import { APPLE_CALENDAR_ID } from "#shared/apple-calendar";

/** One connectable calendar source the gate offers, absent where the build cannot. */
export interface CalendarGateSource {
  /** True while this source's connect is under way, which holds both buttons. */
  connecting: boolean;
  /** Starts the source's own consent flow, the same one its settings row runs. */
  onConnect: () => void;
}

/**
 * The sources the gate may offer. Assembled by the app, which is what knows
 * the build's capabilities; a gate offered neither is never drawn at all,
 * because a mandatory step with no way through would be a locked door.
 */
export interface CalendarGateSources {
  apple?: CalendarGateSource;
  google?: CalendarGateSource;
}

/**
 * The mandatory calendar step of onboarding, standing where the roster would
 * be from the first sign-in until a calendar connects. It only asks: each
 * button runs the same consent flow the source's settings row does, and the
 * gate falls on the connection the main process records, never on anything
 * decided here.
 */
export function CalendarGate({
  sources,
  onQuit,
}: {
  sources: CalendarGateSources;
  onQuit: () => void;
}): React.JSX.Element {
  const pending = sources.apple?.connecting === true || sources.google?.connecting === true;
  return (
    <section className="sign-in-gate calendar-gate" aria-labelledby="calendar-gate-title">
      <h1 id="calendar-gate-title">Quiet during meetings</h1>
      <p>
        Luke speaks up when a session needs you. Connect a calendar so announcements wait while you
        are in a meeting — he reads only when meetings start and end, never their titles or who
        attends.
      </p>
      <div className="sign-in-actions">
        {sources.apple ? (
          <button
            type="button"
            className="sign-in-provider"
            disabled={pending}
            onClick={sources.apple.onConnect}
          >
            <ProviderMark providerId={APPLE_CALENDAR_ID} />
            Use this Mac's Calendar
          </button>
        ) : null}
        {sources.google ? (
          <button
            type="button"
            className="sign-in-provider"
            disabled={pending}
            onClick={sources.google.onConnect}
          >
            <ProviderMark providerId={GOOGLE_CALENDAR_ID} />
            Connect Google Calendar
          </button>
        ) : null}
      </div>
      {/* The way out, quiet on purpose, exactly as the sign-in gate keeps it. */}
      <button type="button" className="sign-in-quit" onClick={onQuit}>
        Quit Luke
      </button>
    </section>
  );
}
