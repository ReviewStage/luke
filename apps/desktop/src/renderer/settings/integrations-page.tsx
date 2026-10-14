import type { IntegrationStatusView } from "@sidecar/hosted/integration-view";
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
import { GRANT_OUTCOME, grantedBySignIn, useIntegrationGrant } from "../integration-grant";
import {
  CONNECTION_HEALTH,
  type ConnectionHealth,
  connectionHealth,
  toolsCount,
} from "../integration-health";
import { IntegrationMark } from "../integration-marks";
import { SIGN_IN, SIGN_IN_ACTION, type SignIn, signInLine } from "../integration-sign-in";
import { type IntegrationStatuses, useIntegrationStatuses } from "../integration-statuses";
import { useIntegrationTools } from "../integration-tools";
import { CONNECT_GITHUB_LABEL } from "../planning/planning-model";
import { RetryButton } from "../retry-button";
import { SPINNER_SIZE, SpinnerRing } from "../spinner";
import { ConfirmDialog, useConfirmDialog } from "./confirm-dialog";
import { MenuRow } from "./menu-row";
import { SettingsGroup } from "./settings-group";

/**
 * integrations-page.tsx -- Settings › Integrations: the services the account connects so Luke's agents can use them.
 *
 * One row per provider: its mark and name, and under it where its connection
 * stands once that needs saying — connected with the count of its server's
 * tools, a sign-in under way, or one expired. A sign-in begun waits on the
 * browser with Reopen and Cancel, and one that failed or never finished
 * says so with Try again (`integration-sign-in.ts`). A connection is said to be
 * connected only once its server answered with its tools; one whose server
 * answered why it would not says why instead, and offers Reconnect where
 * that mends it (`integration-health.ts`). A Connect sends the browser to
 * sign in with the provider; a connected row's ⋯ (or a right-click on it)
 * offers Disconnect, which asks first in the confirm dialog. GitHub is
 * granted by the account's own GitHub (`integration-grant.ts`), so its row
 * offers Connect GitHub, which opens Settings › Connected accounts, and no
 * Disconnect. The window never sees a sign-in address; the
 * host opens it. Where every
 * connection stands is read once for the page (`integration-statuses.ts`),
 * when it is drawn and whenever the window is focused, which is how the
 * developer comes back from the browser. A provider this deployment does not
 * offer the account has no row, as its agents are never handed it. Every
 * line is fixed by the build, but for the one-line reason a provider's
 * server gave, which the service passes on only where it carries no
 * credential.
 */

const PAGE_LINE = {
  CONNECTED: "Connected",
  CHECKING: "Checking…",
  SIGNED_OUT: "Sign in to connect integrations.",
  READ_FAILED: "Your integrations could not be read.",
  NONE_OFFERED: "No integrations are available for this account.",
  NOT_OPENED: "Luke could not open your browser to sign in.",
} as const;

/** What a row's line looks like: connected with its dot, a problem in the attention tint, a wait with its ring, or plain. */
const LINE_STATE = {
  CONNECTED: "connected",
  ATTENTION: "attention",
  WAITING: "waiting",
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

/** A sign-in's line: its wait with the ring, a failure in the attention tint, or one unfinished, plain. */
function signInRowLine(provider: IntegrationProvider, signIn: SignIn): RowLine {
  const { text, problem } = signInLine(provider, signIn);
  if (signIn.kind === SIGN_IN.WAITING) return { text, state: LINE_STATE.WAITING };
  return { text, state: problem ? LINE_STATE.ATTENTION : LINE_STATE.PLAIN };
}

/**
 * The line under a row's name: a sign-in the window waits on or last waited
 * on, else where the connection stands, or nothing where the row's own
 * control already says it — a Connect, or a row whose status has not been
 * read. A connection that stands outranks a sign-in, which a read that
 * finds it connected ends anyway.
 */
function rowLine(
  provider: IntegrationProvider,
  status: IntegrationStatus | undefined,
  health: ConnectionHealth,
  signIn: SignIn | undefined,
): RowLine | undefined {
  if (status === INTEGRATION_STATUS.CONNECTED) return connectedLine(health);
  if (signIn !== undefined) return signInRowLine(provider, signIn);
  switch (status) {
    case INTEGRATION_STATUS.PENDING:
      return undefined;
    case INTEGRATION_STATUS.EXPIRED:
      return { text: "Sign-in expired.", state: LINE_STATE.ATTENTION };
    case INTEGRATION_STATUS.DISCONNECTED:
    case undefined:
    case INTEGRATION_STATUS.UNAVAILABLE:
      return undefined;
  }
}

/** What a row's grant button says: Connect GitHub for GitHub, Try again after a sign-in that did not connect, else Connect or Reconnect. */
function grantLabel(
  bySignIn: boolean,
  status: IntegrationStatus | undefined,
  signIn: SignIn | undefined,
): string {
  if (bySignIn) return CONNECT_GITHUB_LABEL;
  if (status === INTEGRATION_STATUS.CONNECTED) return "Reconnect";
  if (signIn !== undefined) return SIGN_IN_ACTION.TRY_AGAIN;
  return status === INTEGRATION_STATUS.EXPIRED ? "Reconnect" : "Connect";
}

/** A row's line, with the ring before a wait's words. */
function RowLineText({ line }: { line: RowLine }): React.JSX.Element {
  return (
    <small className="settings-state" data-state={line.state}>
      {line.state === LINE_STATE.WAITING ? (
        <span className="spinner" data-size={SPINNER_SIZE.INLINE}>
          <SpinnerRing />
        </span>
      ) : null}
      {line.text}
    </small>
  );
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
  const { settle, cancelSignIn } = statuses;
  const grant = useIntegrationGrant(statuses);
  const bySignIn = grantedBySignIn(provider);
  const signIn = statuses.signInOf(provider);
  const [connecting, setConnecting] = useState(false);
  const [rejection, setRejection] = useState<string | undefined>(undefined);

  const connect = useCallback(() => {
    setConnecting(true);
    setRejection(undefined);
    void grant.begin(provider).then((outcome) => {
      setConnecting(false);
      if (outcome === GRANT_OUTCOME.NOT_OPENED) setRejection(PAGE_LINE.NOT_OPENED);
      if (outcome === GRANT_OUTCOME.REFUSED) {
        setRejection(`Luke could not start connecting ${name}. Try again in a moment.`);
      }
    });
  }, [grant, provider, name]);

  const cancel = useCallback(() => {
    setConnecting(true);
    setRejection(undefined);
    void cancelSignIn(provider).then((cancelled) => {
      setConnecting(false);
      if (!cancelled)
        setRejection(`Luke could not cancel connecting ${name}. Try again in a moment.`);
    });
  }, [cancelSignIn, provider, name]);

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

  const line = rowLine(provider, status, health, signIn);
  const broken = connected && health.kind === CONNECTION_HEALTH.BROKEN && health.reconnect;
  const waiting = !connected && signIn?.kind === SIGN_IN.WAITING;
  // A grant that is the account's GitHub sign-in ends with that sign-in, never here.
  const actions =
    connected && !bySignIn
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
          {line === undefined ? null : <RowLineText line={line} />}
        </span>
        {waiting ? (
          <>
            <button
              type="button"
              className="toolbar-button quiet-button"
              disabled={connecting}
              title={`Open the ${name} sign-in in your browser again`}
              onClick={connect}
            >
              {SIGN_IN_ACTION.REOPEN}
            </button>
            <button
              type="button"
              className="toolbar-button bordered-button"
              disabled={connecting}
              onClick={cancel}
            >
              {SIGN_IN_ACTION.CANCEL}
            </button>
          </>
        ) : status === undefined ||
          status === INTEGRATION_STATUS.UNAVAILABLE ||
          (connected && !broken) ? null : (
          <button
            type="button"
            className="toolbar-button bordered-button"
            disabled={connecting}
            title={bySignIn ? "Connect GitHub in your browser" : `Sign in to ${name} in your browser`}
            onClick={connect}
          >
            {grantLabel(bySignIn, status, signIn)}
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
 * Every offered provider's row, once where they stand has been read, so each
 * row is drawn whole at once; a read that failed draws them all, offering
 * nothing, and says so above them, with the way to read again. A provider
 * read as unavailable is not offered to the account and has no row.
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
  const offered = INTEGRATION_PROVIDER_LIST.filter(
    (provider) => statuses.statusOf(provider) !== INTEGRATION_STATUS.UNAVAILABLE,
  );
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
      {offered.length === 0 ? (
        <p className="settings-note">{PAGE_LINE.NONE_OFFERED}</p>
      ) : (
        <SettingsGroup>
          {offered.map((provider) => (
            <IntegrationRow
              key={provider}
              provider={provider}
              status={statuses.statusOf(provider)}
              health={connectionHealth(provider, reads[provider])}
              statuses={statuses}
            />
          ))}
        </SettingsGroup>
      )}
    </>
  );
}

export function IntegrationsSection({ signedIn }: { signedIn: boolean }): React.JSX.Element {
  return signedIn ? <IntegrationRows /> : <p className="settings-note">{PAGE_LINE.SIGNED_OUT}</p>;
}
