import { useEffect, useRef, useState } from "react";
import { SUPERSET_SIGN_IN_STAGE, type SupersetSignInSnapshot } from "../shared/contracts";
import { SUPERSET_WORKSPACE_PROVIDER_ID } from "../shared/superset";
import { HIT_REGION } from "./panel-state";
import { ProviderMark } from "./provider-marks";
import { ExternalIcon } from "./settings-icons";

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
  const pasteArmed = useRef(false);
  useEffect(() => {
    if (drawn && state.stage === SUPERSET_SIGN_IN_STAGE.BROWSER_CODE) input.current?.focus();
    if (state.stage !== SUPERSET_SIGN_IN_STAGE.BROWSER_CODE) setCode("");
  }, [drawn, state.stage]);

  const waiting = state.stage === SUPERSET_SIGN_IN_STAGE.BROWSER_CODE;
  const exchanging = state.stage === SUPERSET_SIGN_IN_STAGE.EXCHANGING;
  const failed = state.stage === SUPERSET_SIGN_IN_STAGE.FAILURE;
  const choosing = state.stage === SUPERSET_SIGN_IN_STAGE.ORGANIZATION;

  return (
    <div className="slot-stage" data-drawn={String(drawn)} aria-hidden={!drawn} inert={!drawn}>
      {/* Dressed like every other slot: the same shape, and Superset's own
          mark naming whose sign-in this is, the way the key and consent slots
          introduce their providers. */}
      <div className="key-slot sign-in-slot" ref={measure} data-hit-region={HIT_REGION.SLOT}>
        <div className="key-slot-row">
          <span className="key-slot-mark">
            <ProviderMark providerId={SUPERSET_WORKSPACE_PROVIDER_ID} />
          </span>
          <span className="sign-in-slot-copy" role="status">
            <strong>
              {failed
                ? "Not connected"
                : choosing
                  ? "Choose a Superset organization"
                  : "Finish signing in with Superset"}
            </strong>
            {waiting ? (
              <small>
                Copy the code from the browser, then press ⌘V here.{" "}
                <button type="button" className="link-button" onClick={onReopen}>
                  Open the page again
                  <ExternalIcon />
                </button>
              </small>
            ) : null}
            {exchanging ? <small>Connecting…</small> : null}
            {failed ? <small>{state.failure}</small> : null}
          </span>
          <button type="button" className="quiet-button" onClick={failed ? onRetry : onCancel}>
            {failed ? "Retry" : "Cancel"}
          </button>
        </div>
        {waiting || exchanging ? (
          <form
            className="key-slot-row superset-code-row"
            onSubmit={(event) => {
              event.preventDefault();
              if (code) onSubmit(code);
            }}
          >
            <input
              ref={input}
              className="settings-input key-slot-input"
              aria-label="Superset sign-in code"
              placeholder="Paste Superset code"
              value={code}
              disabled={exchanging}
              onKeyDown={(event) => {
                pasteArmed.current = event.metaKey && event.key.toLowerCase() === "v";
                if (
                  !pasteArmed.current &&
                  (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete")
                ) {
                  event.preventDefault();
                }
              }}
              onKeyUp={() => {
                pasteArmed.current = false;
              }}
              onPaste={(event) => {
                event.preventDefault();
                if (!pasteArmed.current) return;
                pasteArmed.current = false;
                setCode(event.clipboardData.getData("text"));
              }}
              onChange={() => undefined}
            />
            <button
              type="submit"
              className="action-button key-slot-confirm"
              data-ready={String(code.length > 0)}
              disabled={!code || exchanging}
            >
              {exchanging ? "Connecting…" : "Continue"}
            </button>
          </form>
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
        {failed ? (
          <div className="key-slot-foot">
            <button type="button" className="link-button" onClick={onCancel}>
              Close
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
