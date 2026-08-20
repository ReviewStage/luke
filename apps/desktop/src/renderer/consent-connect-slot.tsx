import { useRef } from "react";
import {
  CONSENT_SERVICE_NAME,
  CONSENT_SERVICE_WAIT,
  type ConsentServiceId,
} from "#shared/consent-services";
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
 * A refusal's own words with its "System Settings" made pressable: the
 * sentence names where the fix lives, so the words are the way there. The
 * button opens the pane the main process fixes — no address crosses from
 * here — and a sentence that never says the words is rendered untouched.
 * Offered only where the service's wait says the pane is the way back.
 */
function SystemSettingsSentence({
  text,
  onOpen,
}: {
  text: string;
  onOpen: () => void;
}): React.JSX.Element {
  const parts = text.split("System Settings");
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts[0]}
      <button type="button" className="link-button" onClick={onOpen}>
        System Settings
      </button>
      {parts.slice(1).join("System Settings")}
    </>
  );
}

/**
 * The panel stood down while a consent ask waits on the user — the same
 * courtesy the key slot pays: Luke floats above every window, including a
 * provider's consent page and macOS's own consent dialog, so the shape
 * shrinks to a line that says what it is waiting for and the one way to stop
 * waiting. The flow finishes in the browser or the system dialog and the
 * main process; when it does, the panel comes back on its own around the
 * newly connected service.
 *
 * One slot serves every consent flow, so no two of them can introduce
 * themselves differently: only the mark, the name, and what the small line
 * asks for change.
 */
export function ConsentConnectSlot({
  entry,
  drawn,
  onCancel,
  onReopen,
  onOpenSystemSettings,
  measure,
}: {
  entry: ConsentConnectEntry | undefined;
  /** True while this slot is the shape the surface is drawn as. */
  drawn: boolean;
  onCancel: () => void;
  /** Opens the waiting sign-in's consent page again, for a tab lost or closed. */
  onReopen: () => void;
  /** Opens the pane where a refused system grant is undone. */
  onOpenSystemSettings: () => void;
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
              {held.rejection && CONSENT_SERVICE_WAIT[held.serviceId].settingsPane ? (
                // A refusal that names System Settings carries the way there
                // in its own words.
                <SystemSettingsSentence text={held.rejection} onOpen={onOpenSystemSettings} />
              ) : (
                (held.rejection ?? CONSENT_SERVICE_WAIT[held.serviceId].detail)
              )}{" "}
              {/* The lost-tab way back in, on the key slot's own terms: a
                  button, not an anchor — the main process reopens the page
                  the waiting flow built, and no address crosses from here.
                  Only while a browser flow is still waiting: a failed sign-in
                  has no page listening to go back to, and the system's own
                  dialog cannot be lost or summoned again. */}
              {held.rejection || !CONSENT_SERVICE_WAIT[held.serviceId].reopens ? null : (
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
