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
 * What the gate can do, assembled by the app, which is what knows the
 * build's capabilities. A gate offered no source is never drawn at all,
 * because an onboarding step with nothing to offer would be a locked door.
 */
export interface CalendarGateControl {
  apple?: CalendarGateSource;
  google?: CalendarGateSource;
  /** Declines the step for good; the settings rows stay the way to connect later. */
  onSkip: () => void;
}

/**
 * The calendar step of onboarding, standing where the roster would be from
 * the first sign-in until it is answered — by a calendar connecting, or by
 * the quiet skip declining it. It only asks: each button runs the same
 * consent flow the source's settings row does, and the gate falls on the
 * answer the main process records, never on anything decided here.
 */
export function CalendarGate({
  control,
  onQuit,
}: {
  control: CalendarGateControl;
  onQuit: () => void;
}): React.JSX.Element {
  const pending = control.apple?.connecting === true || control.google?.connecting === true;
  return (
    <section className="sign-in-gate calendar-gate" aria-labelledby="calendar-gate-title">
      <h1 id="calendar-gate-title">Quiet during meetings</h1>
      <p>
        Luke speaks up when a session needs you. Connect a calendar so announcements wait while you
        are in a meeting — he reads only when meetings start and end, never their titles or who
        attends.
      </p>
      <div className="sign-in-actions">
        {control.apple ? (
          <button
            type="button"
            className="sign-in-provider"
            disabled={pending}
            onClick={control.apple.onConnect}
          >
            <ProviderMark providerId={APPLE_CALENDAR_ID} />
            Use this Mac's Calendar
          </button>
        ) : null}
        {control.google ? (
          <button
            type="button"
            className="sign-in-provider"
            disabled={pending}
            onClick={control.google.onConnect}
          >
            <ProviderMark providerId={GOOGLE_CALENDAR_ID} />
            Connect Google Calendar
          </button>
        ) : null}
      </div>
      {/* Both ways out, quiet on purpose: the skip answers the step and is
          remembered, the quit only postpones it — so the skip leads. */}
      <div className="calendar-gate-footer">
        <button
          type="button"
          className="calendar-gate-skip"
          disabled={pending}
          onClick={control.onSkip}
        >
          Set up later
        </button>
        <button type="button" className="sign-in-quit" onClick={onQuit}>
          Quit Luke
        </button>
      </div>
    </section>
  );
}
