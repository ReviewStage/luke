import {
  INTEGRATION_CALL_FAILURE,
  type IntegrationStatusView,
} from "@sidecar/hosted/integration-view";
import {
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@sidecar/hosted/integration-wire";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import { useCallback, useEffect, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";
import { searchAnchorProps } from "../settings-anchors";
import { useConfirm } from "./confirm-state";
import { ConfirmSwap } from "./confirm-swap";

/**
 * The account's integrations, one row each: where a connection stands, a
 * Connect that sends the browser to sign in with the provider, and a
 * Disconnect that asks first. The window never sees a sign-in address; the
 * host opens it. Where every connection stands is read once for all the rows,
 * when they are drawn and whenever the window is focused, which is how the
 * developer comes back from the browser. Every line is fixed by the build;
 * nothing the service said beyond its status words is drawn.
 */

/** What a disconnected row offers, in the provider's own terms. */
const INTEGRATION_OFFER = {
  [INTEGRATION_PROVIDER.LINEAR]:
    "Let your planning assistant and coding agents read and update Linear.",
} as const satisfies Record<IntegrationProvider, string>;

/** What a row says under its name, for each place its connection can stand. */
function statusLine(provider: IntegrationProvider, status: IntegrationStatus): string {
  const name = INTEGRATION_NAME[provider];
  switch (status) {
    case INTEGRATION_STATUS.CONNECTED:
      return "Connected. Your planning assistant and coding agents can use it.";
    case INTEGRATION_STATUS.PENDING:
      return `Finish signing in to ${name} in your browser.`;
    case INTEGRATION_STATUS.EXPIRED:
      return `${name}'s sign-in has expired. Connect again to keep using it.`;
    case INTEGRATION_STATUS.DISCONNECTED:
      return INTEGRATION_OFFER[provider];
    case INTEGRATION_STATUS.UNAVAILABLE:
      return `${name} is not available on Luke's service yet.`;
  }
}

const ROW_LINE = {
  READING: "Reading the connection…",
  READ_FAILED: "Luke could not read the connection.",
  NOT_OPENED: "Luke could not open your browser to sign in.",
} as const;

/** The statuses a Connect is offered on: every one but connected and a service with no such connector. */
function offersConnect(status: IntegrationStatus): boolean {
  return status !== INTEGRATION_STATUS.CONNECTED && status !== INTEGRATION_STATUS.UNAVAILABLE;
}

/** Where every provider stands, as the rows share it. */
export interface IntegrationStatuses {
  /** Where one provider stands, or nothing until the first read answers. */
  readonly statusOf: (provider: IntegrationProvider) => IntegrationStatus | undefined;
  /** Whether the last read answered nothing a row can draw. */
  readonly readFailed: boolean;
  readonly read: () => Promise<void>;
  /** One provider's standing as an answer of the host's left it, ahead of the next read. */
  readonly settle: (provider: IntegrationProvider, status: IntegrationStatus) => void;
  /** A sign-in begun: the provider stands pending, unless it stands expired, which it stays until the sign-in settles. */
  readonly signInBegun: (provider: IntegrationProvider) => void;
}

/** Where every provider stands, read when drawn and again whenever the window is focused. */
export function useIntegrationStatuses(): IntegrationStatuses {
  const { act } = useAct();
  const [statuses, setStatuses] = useState<
    Partial<Record<IntegrationProvider, IntegrationStatus>> | undefined
  >(undefined);
  const [readFailed, setReadFailed] = useState(false);

  const read = useCallback(() => {
    setReadFailed(false);
    return act(ACT_KIND.INTEGRATIONS_STATUS).then(
      (answer) => {
        if ("failure" in answer) setReadFailed(true);
        else setStatuses(answer.integrations);
      },
      () => setReadFailed(true),
    );
  }, [act]);

  // The focus is the developer back from the browser, where a sign-in settles.
  useEffect(() => {
    void read();
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, [read]);

  const settle = useCallback((provider: IntegrationProvider, status: IntegrationStatus) => {
    setStatuses((standing) => ({ ...standing, [provider]: status }));
  }, []);

  // Note that the check is made on the standing at the moment of the update, because a focus read may have landed since the press.
  const signInBegun = useCallback((provider: IntegrationProvider) => {
    setStatuses((standing) =>
      standing?.[provider] === INTEGRATION_STATUS.EXPIRED
        ? standing
        : { ...standing, [provider]: INTEGRATION_STATUS.PENDING },
    );
  }, []);

  return { statusOf: (provider) => statuses?.[provider], readFailed, read, settle, signInBegun };
}

export function IntegrationRow({
  provider,
  statuses,
}: {
  provider: IntegrationProvider;
  statuses: IntegrationStatuses;
}): React.JSX.Element {
  const { act } = useAct();
  const name = INTEGRATION_NAME[provider];
  const status = statuses.statusOf(provider);
  const { readFailed, read, settle, signInBegun } = statuses;
  const [connecting, setConnecting] = useState(false);
  const [rejection, setRejection] = useState<string | undefined>(undefined);

  const connect = useCallback(() => {
    setConnecting(true);
    setRejection(undefined);
    act(ACT_KIND.INTEGRATIONS_CONNECT, { provider })
      .catch(() => undefined)
      .then((answer) => {
        setConnecting(false);
        if (answer === undefined || "failure" in answer) {
          setRejection(
            answer?.failure === INTEGRATION_CALL_FAILURE.NOT_OPENED
              ? ROW_LINE.NOT_OPENED
              : `Luke could not start connecting ${name}. Try again in a moment.`,
          );
          return;
        }
        signInBegun(provider);
      });
  }, [act, provider, name, signInBegun]);

  const disconnect = useConfirm(
    { subject: status === INTEGRATION_STATUS.CONNECTED, surfaceOpen: true },
    async (): Promise<ActionResult> => {
      const answer: IntegrationStatusView | undefined = await act(
        ACT_KIND.INTEGRATIONS_DISCONNECT,
        { provider },
      ).catch(() => undefined);
      if (answer === undefined || "failure" in answer) {
        return {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: `Luke could not disconnect ${name}. Try again in a moment.`,
        };
      }
      settle(provider, answer.status);
      return { status: ACTION_RESULT_STATUS.ACCEPTED };
    },
  );

  const line =
    status !== undefined
      ? statusLine(provider, status)
      : readFailed
        ? ROW_LINE.READ_FAILED
        : ROW_LINE.READING;

  return (
    <>
      <div className="settings-row" {...searchAnchorProps(provider)}>
        <span className="settings-copy">
          <strong>{name}</strong>
          <small>{line}</small>
        </span>
        {status === INTEGRATION_STATUS.CONNECTED ? (
          <ConfirmSwap
            confirm={{
              question: `Disconnect ${name}? What Luke already did there stays.`,
              stage: disconnect.stage,
              verb: "Disconnect",
              running: "Disconnecting…",
              onKeep: disconnect.keep,
              onAct: disconnect.run,
            }}
          >
            <button
              type="button"
              className="toolbar-button integration-disconnect"
              disabled={disconnect.busy}
              /* The ellipsis is the promise that it asks first. */
              title={`Disconnect ${name}…`}
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
            title={`Sign in to ${name} in your browser`}
            onClick={connect}
          >
            {status === INTEGRATION_STATUS.DISCONNECTED ? "Connect" : "Connect again"}
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
