import { useRef } from "react";
import { ACCOUNT_PROVIDER, type AccountProvider } from "#shared/contracts";
import { AccountProviderMark } from "./account-marks";
import { useStagedFocus } from "./credential-entry";
import { HIT_REGION } from "./panel-state";

/**
 * The panel stood down to the sign-in it is waiting on, the way it stands down
 * to the key slot: the browser holds the actual work, so Luke gets out of its
 * way and leaves one small shape saying what he is waiting for — and the one
 * control that can take the wait back. Nothing the pointer does dismisses it;
 * Cancel and the sign-in landing are its only ways out.
 */
export function SignInSlot({
  provider,
  drawn,
  onCancel,
  measure,
}: {
  /** Whose sign-in is being waited on; absent once the wait has ended. */
  provider?: AccountProvider;
  /** True while the slot is the shape the surface is drawn as. */
  drawn: boolean;
  onCancel: () => void;
  /** Reports the slot's height, so the surface can end where it does. */
  measure: (element: HTMLElement | null) => void;
}): React.JSX.Element | null {
  const cancel = useRef<HTMLButtonElement | null>(null);
  // The slot outlives the wait that filled it, like the key slot does: it
  // keeps saying what it was saying until the shape has left it behind.
  const held = useRef(provider);
  if (provider) held.current = provider;
  const shown = held.current;
  const live = drawn && provider !== undefined;

  // The one control is what the keyboard lands on, so Escape and Enter both
  // answer the shape that is actually on screen.
  useStagedFocus(cancel, live);

  if (!shown) return null;

  const name = shown === ACCOUNT_PROVIDER.GITHUB ? "GitHub" : "Google";
  return (
    <div className="slot-stage" data-drawn={String(drawn)} aria-hidden={!live} inert={!live}>
      <div className="key-slot sign-in-slot" ref={measure} data-hit-region={HIT_REGION.SLOT}>
        <div className="key-slot-row">
          <span className="key-slot-mark sign-in-slot-mark">
            <AccountProviderMark provider={shown} />
          </span>
          <span className="sign-in-slot-copy" role="status">
            <strong>Waiting for {name}…</strong>
            <small>Finish in your browser.</small>
          </span>
          <button type="button" ref={cancel} className="quiet-button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
