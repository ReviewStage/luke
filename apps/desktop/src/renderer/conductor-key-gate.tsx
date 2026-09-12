import { CREDENTIAL_PROVIDER_ID } from "@sidecar/credentials/vocabulary";
import { ProviderMark } from "@sidecar/panel";

/**
 * What the gate can do, assembled by the app: the same Connect press the
 * Connections row runs, which opens the key entry in the slot and the
 * provider's key page, and the quiet skip.
 */
export interface ConductorKeyGateControl {
  /** True while a key entry is open, which holds the connect. */
  connecting: boolean;
  onConnect: () => void;
  /** Declines the step for good; the Connections row stays the way to connect later. */
  onSkip: () => void;
}

/**
 * The Conductor key step of onboarding, standing where the roster would be
 * from the first sign-in, after the spoken introduction and ahead of the
 * calendar step, until it is answered. It falls on the host's word alone: the
 * vault coming to hold a key, or the skip. Unlike the calendar gate it speaks
 * for itself on screen, because no beat announces it: the greeting just said
 * "let's get you set up", and this is the setting up. What it says about the
 * key is the same thing PRIVACY.md says: held by Luke's service, never here.
 */
export function ConductorKeyGate({
  control,
  onQuit,
}: {
  control: ConductorKeyGateControl;
  onQuit: () => void;
}): React.JSX.Element {
  return (
    <section
      className="sign-in-gate calendar-gate conductor-key-gate"
      aria-label="Connect Conductor"
    >
      <p>Connect Conductor to see your coding agents here.</p>
      <div className="sign-in-actions">
        <button
          type="button"
          className="sign-in-provider"
          disabled={control.connecting}
          onClick={control.onConnect}
        >
          <ProviderMark providerId={CREDENTIAL_PROVIDER_ID.CONDUCTOR} />
          Connect Conductor
        </button>
      </div>
      <small>Your key is held by Luke's service, never on this Mac.</small>
      <div className="calendar-gate-footer">
        <button
          type="button"
          className="calendar-gate-skip"
          disabled={control.connecting}
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
