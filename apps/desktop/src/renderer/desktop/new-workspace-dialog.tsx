import { WORKSPACE_BOUNDS } from "@sidecar/hosted/workspace-wire";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { trappedTab } from "../settings/confirm-dialog";
import { BusyLabel } from "../spinner";
import { useStagedFocus } from "../staged-focus";

/**
 * new-workspace-dialog.tsx -- the small prompt the switcher's New workspace… opens: a name, Cancel, and Create.
 *
 * It is drawn on the confirm dialog's card, so it dims the window, keeps Tab
 * inside, and hands focus back to whatever opened it. The name is held to
 * the service's bound and must not be blank; Enter creates, Escape or a
 * press on the dimmed window cancels. A create the service refuses says why
 * on the card and leaves the name as typed for another try.
 */

/** What the card says while the create is under way. */
const CREATING = "Creating workspace";

export function NewWorkspaceDialog({
  onCreate,
  onClose,
}: {
  /** Creates the workspace named, answering why it was not created, or nothing once it was. */
  onCreate: (name: string) => Promise<string | undefined>;
  onClose: () => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const field = useRef<HTMLInputElement | null>(null);
  const invoker = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // Note that the opener is read before the field takes focus, because once
  // it has, the control that opened the card no longer holds it.
  useLayoutEffect(() => {
    invoker.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (invoker.current?.isConnected) invoker.current.focus({ preventScroll: true });
    };
  }, []);
  useStagedFocus(field, !busy);

  const trimmed = name.trim();
  const close = () => {
    if (!busy) onClose();
  };
  const create = () => {
    if (busy || trimmed === "") return;
    setBusy(true);
    setRefusal(undefined);
    onCreate(trimmed).then((refused) => {
      setBusy(false);
      if (refused === undefined) onClose();
      else setRefusal(refused);
    });
  };
  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // No key pressed in the card goes on to the window, as the confirm
    // dialog's own keys do not.
    event.stopPropagation();
    if (event.key === "Tab") {
      trappedTab(event);
      return;
    }
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
  };

  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: the dimmed window is a pointer target alone; the keys it hears come from the card's own focus.
    <div
      className="confirm-dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onKeyDown={keyDown}
    >
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy}
        tabIndex={-1}
      >
        <h2 id={titleId} className="confirm-dialog-title">
          New workspace
        </h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            create();
          }}
        >
          <input
            ref={field}
            className="settings-input"
            aria-label="Workspace name"
            placeholder="Workspace name"
            maxLength={WORKSPACE_BOUNDS.MAX_NAME_CHARS}
            value={name}
            disabled={busy}
            onChange={(event) => {
              setName(event.target.value);
              setRefusal(undefined);
            }}
          />
          {refusal === undefined ? null : (
            <p className="confirm-dialog-error" role="alert">
              {refusal}
            </p>
          )}
          <div className="confirm-dialog-actions">
            <button type="button" className="toolbar-button" disabled={busy} onClick={close}>
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={busy || trimmed === ""}>
              <BusyLabel busy={busy} label={CREATING}>
                Create
              </BusyLabel>
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
