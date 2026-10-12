import { LINEAR_CALL_FAILURE, type LinearStatusView } from "@sidecar/hosted/linear-view";
import { LINEAR_STATUS, type LinearStatus } from "@sidecar/hosted/linear-wire";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import { useCallback, useEffect, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";
import { SETTINGS_SEARCH_ROW, searchAnchorProps } from "../settings-anchors";
import { useConfirm } from "./confirm-state";
import { ConfirmSwap } from "./confirm-swap";

/**
 * The account's Linear connection, under who is signed in: where it stands,
 * a Connect that sends the browser to sign in with Linear, and a Disconnect
 * that asks first. The window never sees the sign-in address; the host opens
 * it. How the sign-in settled is read again when the row is drawn and when
 * the window is focused, which is how the developer comes back from the
 * browser. Every line is fixed by the build; nothing the service said beyond
 * its status word is drawn.
 */

/** What the row says under its name, for each place the connection can stand. */
const STATUS_LINE = {
  [LINEAR_STATUS.CONNECTED]: "Connected. Your planning assistant and coding agents can use it.",
  [LINEAR_STATUS.PENDING]: "Finish signing in to Linear in your browser.",
  [LINEAR_STATUS.EXPIRED]: "Linear's sign-in has expired. Connect again to keep using it.",
  [LINEAR_STATUS.DISCONNECTED]:
    "Let your planning assistant and coding agents read and update Linear.",
  [LINEAR_STATUS.UNAVAILABLE]: "Linear is not available on Luke's service yet.",
} as const satisfies Record<LinearStatus, string>;

const ROW_LINE = {
  READING: "Reading the connection…",
  READ_FAILED: "Luke could not read the connection.",
  CONNECT_FAILED: "Luke could not start connecting Linear. Try again in a moment.",
  NOT_OPENED: "Luke could not open your browser to sign in.",
  DISCONNECT_FAILED: "Luke could not disconnect Linear. Try again in a moment.",
} as const;

/** The statuses a Connect is offered on: every one but connected and a service with no Linear. */
function offersConnect(status: LinearStatus): boolean {
  return status !== LINEAR_STATUS.CONNECTED && status !== LINEAR_STATUS.UNAVAILABLE;
}

export function LinearRow(): React.JSX.Element {
  const { act } = useAct();
  const [status, setStatus] = useState<LinearStatus | undefined>(undefined);
  const [readFailed, setReadFailed] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [rejection, setRejection] = useState<string | undefined>(undefined);

  /** Where the connection stands, read now; an answer that is no status leaves the line saying so. */
  const read = useCallback(() => {
    setReadFailed(false);
    return act(ACT_KIND.LINEAR_STATUS).then(
      (answer) => {
        if ("failure" in answer) setReadFailed(true);
        else setStatus(answer.status);
      },
      () => setReadFailed(true),
    );
  }, [act]);

  // Read when drawn, and again whenever the window is focused, which is the developer back from the browser.
  useEffect(() => {
    void read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, [read]);

  const connect = useCallback(() => {
    setConnecting(true);
    setRejection(undefined);
    act(ACT_KIND.LINEAR_CONNECT)
      .catch(() => undefined)
      .then((answer) => {
        setConnecting(false);
        if (answer === undefined || "failure" in answer) {
          setRejection(
            answer?.failure === LINEAR_CALL_FAILURE.NOT_OPENED
              ? ROW_LINE.NOT_OPENED
              : ROW_LINE.CONNECT_FAILED,
          );
          return;
        }
        setStatus((standing) =>
          standing === LINEAR_STATUS.EXPIRED ? standing : LINEAR_STATUS.PENDING,
        );
      });
  }, [act]);

  const disconnect = useConfirm(
    { subject: status === LINEAR_STATUS.CONNECTED, surfaceOpen: true },
    async (): Promise<ActionResult> => {
      const answer: LinearStatusView | undefined = await act(ACT_KIND.LINEAR_DISCONNECT).catch(
        () => undefined,
      );
      if (answer === undefined || "failure" in answer) {
        return { status: ACTION_RESULT_STATUS.REJECTED, reason: ROW_LINE.DISCONNECT_FAILED };
      }
      setStatus(answer.status);
      return { status: ACTION_RESULT_STATUS.ACCEPTED };
    },
  );

  const line =
    status !== undefined
      ? STATUS_LINE[status]
      : readFailed
        ? ROW_LINE.READ_FAILED
        : ROW_LINE.READING;

  return (
    <>
      <div className="settings-row" {...searchAnchorProps(SETTINGS_SEARCH_ROW.LINEAR)}>
        <span className="settings-copy">
          <strong>Linear</strong>
          <small>{line}</small>
        </span>
        {status === LINEAR_STATUS.CONNECTED ? (
          <ConfirmSwap
            confirm={{
              question: "Disconnect Linear? What Luke already did there stays.",
              stage: disconnect.stage,
              verb: "Disconnect",
              running: "Disconnecting…",
              onKeep: disconnect.keep,
              onAct: disconnect.run,
            }}
          >
            <button
              type="button"
              className="toolbar-button account-linear-disconnect"
              disabled={disconnect.busy}
              /* The ellipsis is the promise that it asks first. */
              title="Disconnect Linear…"
              onClick={disconnect.ask}
            >
              Disconnect
            </button>
          </ConfirmSwap>
        ) : status !== undefined && offersConnect(status) ? (
          <button
            type="button"
            className="toolbar-button"
            disabled={connecting}
            title="Sign in to Linear in your browser"
            onClick={connect}
          >
            {status === LINEAR_STATUS.DISCONNECTED ? "Connect" : "Connect again"}
          </button>
        ) : readFailed ? (
          <button type="button" className="toolbar-button" onClick={() => void read()}>
            Try again
          </button>
        ) : null}
      </div>
      {rejection !== undefined || disconnect.rejection !== undefined ? (
        <p className="error-message" role="alert">
          {rejection ?? disconnect.rejection}
        </p>
      ) : null}
    </>
  );
}
