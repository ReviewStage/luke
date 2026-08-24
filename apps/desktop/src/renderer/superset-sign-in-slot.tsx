import { ProviderMark } from "@sidecar/panel";
import { SUPERSET_WORKSPACE_PROVIDER_ID } from "@sidecar/session";
import { useEffect, useRef, useState } from "react";
import { CREDENTIAL_SOURCE } from "#shared/wire/account";
import type { SupersetSignInSnapshot } from "#shared/wire/session";
import { SUPERSET_SIGN_IN_STAGE } from "#shared/wire/session";
import { CREDENTIAL_PLACEHOLDER, useStagedFocus } from "./credential-entry";
import { HIT_REGION } from "./panel-state";
import { ExternalIcon } from "./settings-icons";

/**
 * The panel stood down to Superset's sign-in code, on the key slot's exact
 * terms: to anyone standing in front of Luke, a one-time code and an API key
 * are the same errand with a different word on it, so the popup keeps the
 * same shape and the same words — what to paste named above the field in
 * Superset's own word for it, the provider's mark beside it, where the code
 * comes from on the line below, and the confirm quiet until there is
 * something to confirm. Only the stages a key never has — choosing an
 * organization, the switch that choice starts, a sign-in that failed — keep
 * the waiting popups' one-line dress, worded the way the consent slot words
 * them: an organization switch asks for no code, so it never wears the field.
 */
export function SupersetSignInSlot({
  state,
  drawn,
  onSubmit,
  onReopen,
  onCancel,
  onRetry,
  onChooseOrganization,
  measure,
}: {
  state: SupersetSignInSnapshot;
  drawn: boolean;
  onSubmit: (code: string) => void;
  onReopen: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onChooseOrganization: (slug: string) => void;
  measure: (element: HTMLElement | null) => void;
}): React.JSX.Element {
  const [code, setCode] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state.stage !== SUPERSET_SIGN_IN_STAGE.BROWSER_CODE) setCode("");
  }, [state.stage]);

  const waiting = state.stage === SUPERSET_SIGN_IN_STAGE.BROWSER_CODE;
  const exchanging = state.stage === SUPERSET_SIGN_IN_STAGE.EXCHANGING;
  const failed = state.stage === SUPERSET_SIGN_IN_STAGE.FAILURE;
  const choosing = state.stage === SUPERSET_SIGN_IN_STAGE.ORGANIZATION;
  const switching = state.stage === SUPERSET_SIGN_IN_STAGE.SWITCHING;
  const filled = code.trim().length > 0;
  const ready = filled && waiting;

  useStagedFocus(input, drawn && waiting);

  useEffect(() => {
    if (!(drawn && waiting)) return;
    // Coming back from the browser with the code on the clipboard should cost
    // one gesture, not two, exactly as it does for a key: however the window
    // is raised, the caret is already where the code goes.
    const takeCaret = () => input.current?.focus({ preventScroll: true });
    window.addEventListener("focus", takeCaret);
    return () => window.removeEventListener("focus", takeCaret);
  }, [drawn, waiting]);

  return (
    <div className="slot-stage" data-drawn={String(drawn)} aria-hidden={!drawn} inert={!drawn}>
      <div className="key-slot sign-in-slot" ref={measure} data-hit-region={HIT_REGION.SLOT}>
        {waiting || exchanging ? (
          <>
            {/* What to paste, in Superset's own word for it, where every key
                popup names its credential. */}
            <span className="settings-label key-slot-label">Sign-in code</span>
            <div className="key-slot-row">
              <span className="key-slot-mark">
                <ProviderMark providerId={SUPERSET_WORKSPACE_PROVIDER_ID} />
              </span>
              <input
                ref={input}
                className="settings-input key-slot-input"
                type="password"
                aria-label="Superset sign-in code"
                autoComplete="off"
                spellCheck={false}
                placeholder={CREDENTIAL_PLACEHOLDER[CREDENTIAL_SOURCE.NONE]}
                value={code}
                disabled={exchanging}
                onChange={(event) => setCode(event.target.value)}
                onFocus={() => {
                  // The slot is shown without stealing focus, and a field that
                  // cannot be typed into is worse than no field.
                  window.sidecar.focusPanel();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && ready) onSubmit(code);
                  // Escape belongs to the sign-in here: there is no panel
                  // behind the slot to close.
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    onCancel();
                  }
                }}
              />
            </div>
            <div className="settings-row key-slot-foot">
              <small className="settings-note">
                Superset shows a one-time code at the end of its sign-in page.{" "}
                {/* A button, not an anchor, like the key slot's own: the main
                    process reopens the page the waiting flow built, and no
                    address crosses from here. */}
                <button
                  type="button"
                  className="link-button"
                  disabled={exchanging}
                  onClick={onReopen}
                >
                  Where to get one
                  <ExternalIcon />
                </button>
              </small>
              <span className="settings-actions">
                <button type="button" className="quiet-button" onClick={onCancel}>
                  Cancel
                </button>
                {/* The settings row's own word for what this finishes. It is
                    quiet and small until the code lands in the field, exactly
                    as a key's confirm waits for its key, and stays up to size
                    while the exchange it started runs. */}
                <button
                  type="button"
                  className="action-button key-slot-confirm"
                  data-ready={String(exchanging || filled)}
                  disabled={!ready}
                  onClick={() => onSubmit(code)}
                >
                  {exchanging ? "Connecting…" : "Connect"}
                </button>
              </span>
            </div>
          </>
        ) : null}
        {choosing || switching || failed ? (
          <div className="key-slot-row">
            <span className="key-slot-mark">
              <ProviderMark providerId={SUPERSET_WORKSPACE_PROVIDER_ID} />
            </span>
            <span className="sign-in-slot-copy" role="status">
              <strong>
                {failed
                  ? "Not connected"
                  : switching
                    ? "Connecting…"
                    : "Choose a Superset organization"}
              </strong>
              {failed ? (
                <small>
                  {state.failure}{" "}
                  {/* The settings row's word for redoing the sign-in, dressed
                      like the way back to a lost tab: retrying opens
                      Superset's page again. */}
                  <button type="button" className="link-button" onClick={onRetry}>
                    Sign in again
                    <ExternalIcon />
                  </button>
                </small>
              ) : null}
            </span>
            <button type="button" className="quiet-button" onClick={onCancel}>
              {failed ? "Close" : "Cancel"}
            </button>
          </div>
        ) : null}
        {choosing ? (
          <div className="superset-organization-list">
            {state.organizations.map((organization) => (
              <button
                key={organization.id}
                type="button"
                className="quiet-button"
                onClick={() => onChooseOrganization(organization.slug)}
              >
                {organization.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
