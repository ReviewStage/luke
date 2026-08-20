import { useRef } from "react";
import { CONSENT_SERVICE_NAME, type ConsentServiceId } from "#shared/consent-services";
import { HIT_REGION } from "./panel-state";
import { ProviderMark } from "./provider-marks";
import { ExternalIcon } from "./settings-icons";

/**
 * What the connect entry holds: nothing to type, only which service's page is
 * open, the wait, and its end.
 */
export interface ConsentConnectEntry {
  serviceId: ConsentServiceId;
  busy: boolean;
  rejection?: string;
}

/**
 * The panel stood down while a consent sign-in waits on the browser — the
 * same courtesy the key slot pays: Luke floats above every window, including
 * the provider's consent page, so the shape shrinks to a line that says what
 * it is waiting for and the one way to stop waiting. The flow finishes in the
 * browser and the main process; when it does, the panel comes back on its own
 * around the newly connected service.
 *
 * One slot serves every consent flow, so no two of them can introduce
 * themselves differently: only the mark and the service's name change.
 */
export function ConsentConnectSlot({
  entry,
  drawn,
  onCancel,
  onReopen,
  measure,
}: {
  entry: ConsentConnectEntry | undefined;
  /** True while this slot is the shape the surface is drawn as. */
  drawn: boolean;
  onCancel: () => void;
  /** Opens the waiting sign-in's consent page again, for a tab lost or closed. */
  onReopen: () => void;
  /** Reports the slot's height, so the surface can end where it does. */
  measure: (element: HTMLElement | null) => void;
}): React.JSX.Element | null {
  // The slot outlives the entry that filled it, like the key slot: emptying
  // on the frame the sign-in lands would leave a blank pill on screen for as
  // long as the shape takes to grow back into the panel.
  const heldEntry = useRef(entry);
  if (entry) heldEntry.current = entry;
  const held = heldEntry.current;
  const live = drawn && entry !== undefined;
  if (!held) return null;

  return (
    <div className="slot-stage" data-drawn={String(drawn)} aria-hidden={!live} inert={!live}>
      <div className="key-slot sign-in-slot" ref={measure} data-hit-region={HIT_REGION.SLOT}>
        {/* One line, worded and dressed like the account sign-in's wait: the
            mark, what is being waited for, and the one way to stop waiting —
            only the service's mark and the way back to a lost tab tell the
            popups apart. */}
        <div className="key-slot-row">
          <span className="key-slot-mark">
            <ProviderMark providerId={held.serviceId} />
          </span>
          <span className="sign-in-slot-copy" role="status">
            <strong>
              {held.rejection
                ? "Not connected"
                : `Waiting for ${CONSENT_SERVICE_NAME[held.serviceId]}…`}
            </strong>
            <small>
              {held.rejection ?? "Finish in your browser."}{" "}
              {/* The lost-tab way back in, on the key slot's own terms: a
                  button, not an anchor — the main process reopens the page
                  the waiting flow built, and no address crosses from here.
                  Only while the flow is still waiting: a failed sign-in has
                  no page listening to go back to. */}
              {held.rejection ? null : (
                <button type="button" className="link-button" onClick={onReopen}>
                  Open the page again
                  <ExternalIcon />
                </button>
              )}
            </small>
          </span>
          <button type="button" className="quiet-button" onClick={onCancel}>
            {held.rejection ? "Close" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
