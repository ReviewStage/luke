import {
  INTEGRATION_CALL_FAILURE,
  type IntegrationStatusView,
} from "@sidecar/hosted/integration-view";
import {
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@sidecar/hosted/integration-wire";
import { TrashIcon } from "@sidecar/panel";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import { useCallback, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";
import {
  CONNECTION_HEALTH,
  type ConnectionHealth,
  connectionHealth,
  toolsCount,
} from "../integration-health";
import { IntegrationMark } from "../integration-marks";
import { type IntegrationStatuses, useIntegrationStatuses } from "../integration-statuses";
import { useIntegrationTools } from "../integration-tools";
import { RetryButton } from "../retry-button";
import { ConfirmDialog, useConfirmDialog } from "./confirm-dialog";
import { MenuRow } from "./menu-row";
import { SettingsGroup } from "./settings-group";

/**
 * integrations-page.tsx -- Settings › Integrations: the services the account connects so Luke's agents can use them.
 *
 * One row per provider: its mark and name, and under it where its connection
 * stands once that needs saying — connected with the count of its server's
 * tools, a sign-in under way, or one expired. A connection is said to be
 * connected only once its server answered with its tools; one whose server
 * answered why it would not says why instead, and offers Reconnect where
 * that mends it (`integration-health.ts`). A Connect sends the browser to
 * sign in with the provider; a
 * connected row's ⋯ (or a right-click on it) offers Disconnect, which asks
 * first in the confirm dialog. The window never sees a sign-in address; the
 * host opens it. Where every
 * connection stands is read once for the page (`integration-statuses.ts`),
 * when it is drawn and whenever the window is focused, which is how the
 * developer comes back from the browser. A provider this deployment offers
 * no connector for says so and offers nothing. Every line is fixed by the
 * build, but for the one-line reason a provider's server gave, which the
 * service passes on only where it carries no credential.
 */

const PAGE_LINE = {
  CONNECTED: "Connected",
  CHECKING: "Checking…",
  SIGNED_OUT: "Sign in to connect integrations.",
  READ_FAILED: "Your integrations could not be read.",
  NOT_AVAILABLE: "Not available",
  NOT_OPENED: "Luke could not open your browser to sign in.",
} as const;

/** What a row's line looks like: connected with its dot, a problem in the attention tint, or plain. */
const LINE_STATE = {
  CONNECTED: "connected",
  ATTENTION: "attention",
  PLAIN: "plain",
} as const;

type LineState = (typeof LINE_STATE)[keyof typeof LINE_STATE];

/** The line under a row's name, and how it looks. */
interface RowLine {
  readonly text: string;
  readonly state: LineState;
}

/** A connected row's line, from how its server answered. */
function connectedLine(health: ConnectionHealth): RowLine {
  switch (health.kind) {
    case CONNECTION_HEALTH.WORKING:
      return {
        text: `${PAGE_LINE.CONNECTED} · ${toolsCount(health.tools.length)}`,
        state: LINE_STATE.CONNECTED,
      };
    case CONNECTION_HEALTH.BROKEN:
      return { text: health.problem, state: LINE_STATE.ATTENTION };
    case CONNECTION_HEALTH.CHECKING:
      return { text: PAGE_LINE.CHECKING, state: LINE_STATE.PLAIN };
    case CONNECTION_HEALTH.UNKNOWN:
      return { text: PAGE_LINE.CONNECTED, state: LINE_STATE.CONNECTED };
  }
}

/**
 * The line under a row's name: where the connection stands, or nothing where
 * the row's own control already says it — a Connect, Not available, or a row
 * whose status has not been read.
 */
function rowLine(
  provider: IntegrationProvider,
  status: IntegrationStatus | undefined,
  health: ConnectionHealth,
): RowLine | undefined {
  const name = INTEGRATION_NAME[provider];
  switch (status) {
    case INTEGRATION_STATUS.CONNECTED:
      return connectedLine(health);
    case INTEGRATION_STATUS.PENDING:
      return { text: `Finish signing in to ${name} in your browser.`, state: LINE_STATE.PLAIN };
    case INTEGRATION_STATUS.EXPIRED:
      return { text: "Sign-in expired.", state: LINE_STATE.ATTENTION };
    case INTEGRATION_STATUS.DISCONNECTED:
    case undefined:
    case INTEGRATION_STATUS.UNAVAILABLE:
      return undefined;
  }
}

function IntegrationRow({
  provider,
  status,
  health,
  statuses,
}: {
  provider: IntegrationProvider;
  /** Where the connection stands, or nothing while it has not been read; the row offers nothing until it has. */
  status: IntegrationStatus | undefined;
  /** How a connected provider's server answered when asked for its tools. */
  health: ConnectionHealth;
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

  const connected = status === INTEGRATION_STATUS.CONNECTED;
  const disconnect = useConfirmDialog(
    { subject: connected, surfaceOpen: true },
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

  const line = rowLine(provider, status, health);
  const broken = connected && health.kind === CONNECTION_HEALTH.BROKEN && health.reconnect;
  const actions = connected
    ? [{ label: "Disconnect", icon: <TrashIcon />, danger: true, onSelect: disconnect.ask }]
    : [];
  return (
    <>
      <MenuRow label={`${name} actions`} actions={actions} anchor={provider}>
        <span className="settings-row-mark">
          <IntegrationMark provider={provider} />
        </span>
        <span className="settings-copy">
          <strong>{name}</strong>
          {line === undefined ? null : (
            <small className="settings-state" data-state={line.state}>
              {line.text}
            </small>
          )}
        </span>
        {status === INTEGRATION_STATUS.UNAVAILABLE ? (
          <span className="settings-unavailable">{PAGE_LINE.NOT_AVAILABLE}</span>
        ) : status === undefined || (connected && !broken) ? null : (
          <button
            type="button"
            className="toolbar-button bordered-button"
            disabled={connecting}
            title={`Sign in to ${name} in your browser`}
            onClick={connect}
          >
            {status === INTEGRATION_STATUS.DISCONNECTED
              ? "Connect"
              : broken
                ? "Reconnect"
                : "Connect again"}
          </button>
        )}
      </MenuRow>
      {rejection === undefined ? null : (
        <p className="error-message" role="alert">
          {rejection}
        </p>
      )}
      <ConfirmDialog
        confirm={disconnect}
        question={{
          title: `Disconnect ${name}?`,
          body: "What Luke already did there stays.",
          verb: "Disconnect",
          running: "Disconnecting…",
        }}
      />
    </>
  );
}

/**
 * Every provider's row, once where they stand has been read, so each row is
 * drawn whole at once; a read that failed draws them all, offering nothing,
 * and says so above them, with the way to read again.
 */
function IntegrationRows(): React.JSX.Element {
  const statuses = useIntegrationStatuses();
  const reads = useIntegrationTools(
    INTEGRATION_PROVIDER_LIST.filter(
      (provider) => statuses.statusOf(provider) === INTEGRATION_STATUS.CONNECTED,
    ),
  );
  const read = INTEGRATION_PROVIDER_LIST.some((provider) => statuses.statusOf(provider));
  if (!read && !statuses.readFailed) return <div className="settings-reading" aria-busy="true" />;
  return (
    <>
      {statuses.readFailed ? (
        <>
          <p className="error-message" role="alert">
            {PAGE_LINE.READ_FAILED}
          </p>
          <RetryButton onRetry={() => void statuses.read()} />
        </>
      ) : null}
      <SettingsGroup>
        {INTEGRATION_PROVIDER_LIST.map((provider) => (
          <IntegrationRow
            key={provider}
            provider={provider}
            status={statuses.statusOf(provider)}
            health={connectionHealth(provider, reads[provider])}
            statuses={statuses}
          />
        ))}
      </SettingsGroup>
    </>
  );
}

export function IntegrationsSection({ signedIn }: { signedIn: boolean }): React.JSX.Element {
  return signedIn ? <IntegrationRows /> : <p className="settings-note">{PAGE_LINE.SIGNED_OUT}</p>;
}
