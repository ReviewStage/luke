import {
  INTEGRATION_CALL_FAILURE,
  type IntegrationStatusView,
} from "@sidecar/hosted/integration-view";
import {
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@sidecar/hosted/integration-wire";
import { CheckIcon } from "@sidecar/panel";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import { useCallback, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";
import { IntegrationMark } from "../integration-marks";
import { type IntegrationStatuses, useIntegrationStatuses } from "../integration-statuses";
import { RetryButton } from "../retry-button";
import { searchAnchorProps } from "../settings-anchors";
import { useConfirm } from "./confirm-state";
import { ConfirmSwap } from "./confirm-swap";

/**
 * integrations-page.tsx -- Settings › Integrations: the services the account connects so Luke's agents can use them.
 *
 * One row per provider: its mark and name, what connecting it lets the
 * agents do, and where its connection stands. A Connect sends the browser to
 * sign in with the provider, and a Disconnect asks first, in place. The
 * window never sees a sign-in address; the host opens it. Where every
 * connection stands is read once for the page (`integration-statuses.ts`),
 * when it is drawn and whenever the window is focused, which is how the
 * developer comes back from the browser. A provider this deployment offers
 * no connector for says so and offers nothing. Every line is fixed by the
 * build; nothing the service said beyond its status words is drawn.
 */

/** What connecting each provider lets the agents do, in one line. */
const INTEGRATION_OFFER = {
  [INTEGRATION_PROVIDER.LINEAR]: "Read and update issues, projects, and documents.",
  [INTEGRATION_PROVIDER.NOTION]: "Search, read, and update pages and databases.",
} as const satisfies Record<IntegrationProvider, string>;

const PAGE_LINE = {
  NOTE: "Connected services are used by your planning assistant and coding agents, as your account there sees them.",
  SIGNED_OUT: "Sign in to connect integrations.",
  READ_FAILED: "Your integrations could not be read.",
  NOT_AVAILABLE: "Not available",
  NOT_OPENED: "Luke could not open your browser to sign in.",
} as const;

/** The line under a row's name: what it offers, or what needs the developer's hand. */
function rowLine(provider: IntegrationProvider, status: IntegrationStatus | undefined): string {
  const name = INTEGRATION_NAME[provider];
  switch (status) {
    case undefined:
    case INTEGRATION_STATUS.PENDING:
      return `Finish signing in to ${name} in your browser.`;
    case INTEGRATION_STATUS.EXPIRED:
      return `${name}'s sign-in has expired. Connect again to keep using it.`;
    case INTEGRATION_STATUS.CONNECTED:
    case INTEGRATION_STATUS.DISCONNECTED:
    case INTEGRATION_STATUS.UNAVAILABLE:
      return INTEGRATION_OFFER[provider];
  }
}

function IntegrationRow({
  provider,
  status,
  statuses,
}: {
  provider: IntegrationProvider;
  /** Where the connection stands, or nothing while it has not been read; the row offers nothing until it has. */
  status: IntegrationStatus | undefined;
  statuses: IntegrationStatuses;
}): React.JSX.Element {
  const { act } = useAct();
  const name = INTEGRATION_NAME[provider];
  const { settle, signInBegun } = statuses;
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
              ? PAGE_LINE.NOT_OPENED
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

  return (
    <>
      <div className="settings-row integration-row" {...searchAnchorProps(provider)}>
        <span className="settings-copy">
          <span className="settings-name">
            <IntegrationMark provider={provider} />
            <strong>{name}</strong>
            {status === INTEGRATION_STATUS.CONNECTED ? <CheckIcon /> : null}
          </span>
          <small>{rowLine(provider, status)}</small>
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
        ) : status === INTEGRATION_STATUS.UNAVAILABLE ? (
          <span className="integration-unavailable">{PAGE_LINE.NOT_AVAILABLE}</span>
        ) : status === undefined ? null : (
          <button
            type="button"
            className="toolbar-button"
            disabled={connecting}
            title={`Sign in to ${name} in your browser`}
            onClick={connect}
          >
            {status === INTEGRATION_STATUS.DISCONNECTED ? "Connect" : "Connect again"}
          </button>
        )}
      </div>
      {rejection !== undefined || disconnect.rejection !== undefined ? (
        <p className="error-message" role="alert">
          {rejection ?? disconnect.rejection}
        </p>
      ) : null}
    </>
  );
}

/**
 * Every provider's row, drawn whether or not where they stand has been read,
 * so a search result always has its row to land on: a row offers its action
 * once its status is known, and a read that failed says so above the rows,
 * with the way to read again.
 */
function IntegrationRows(): React.JSX.Element {
  const statuses = useIntegrationStatuses();
  return (
    <>
      <p className="settings-note">{PAGE_LINE.NOTE}</p>
      {statuses.readFailed ? (
        <>
          <p className="error-message" role="alert">
            {PAGE_LINE.READ_FAILED}
          </p>
          <RetryButton onRetry={() => void statuses.read()} />
        </>
      ) : null}
      {INTEGRATION_PROVIDER_LIST.map((provider) => (
        <IntegrationRow
          key={provider}
          provider={provider}
          status={statuses.statusOf(provider)}
          statuses={statuses}
        />
      ))}
    </>
  );
}

export function IntegrationsSection({ signedIn }: { signedIn: boolean }): React.JSX.Element {
  return (
    <section
      className="settings-section settings-plain"
      style={cssCustomProperties({ "--row-index": 1 })}
    >
      {signedIn ? <IntegrationRows /> : <p className="settings-note">{PAGE_LINE.SIGNED_OUT}</p>}
    </section>
  );
}
