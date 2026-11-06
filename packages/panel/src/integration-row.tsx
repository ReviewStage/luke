import { CONNECTION_HEALTH, type ConnectionHealth } from "@repo/features/integration-health";
import {
  SIGN_IN,
  SIGN_IN_ACTION,
  type SignIn,
  signInLine,
} from "@repo/features/integration-sign-in";
import { INTEGRATION_STATUS_WORDS } from "@repo/features/integration-status-words";
import type { IntegrationStatusView } from "@repo/features/integration-view";
import {
  INTEGRATION_ACCOUNTS_MAX,
  INTEGRATION_LABEL_MAX,
  INTEGRATION_NAME,
  INTEGRATION_PURPOSE,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
  integrationAccountLabel,
} from "@repo/features/integration-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readFailedWords } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import {
  AccountWords,
  BUTTON_VARIANT,
  Button,
  CONFIRM_LOSS,
  ConfirmDialog,
  GAP,
  INLINE_EDIT_LOOK,
  InlineEdit,
  type InlineEditEnd,
  motionKey,
  ProviderMark,
  RetryButton,
  SETTINGS_ROW_CONTROLS,
  SETTINGS_ROW_STATE,
  SettingsRowMark,
  type SettingsRowState,
  SettingsRowStateLine,
  SPINNER_SIZE,
  SpinnerRing,
  Stack,
  TextButton,
  useConfirmDialog,
} from "@repo/ui";
import type { ServerRow } from "@repo/ui/agent-servers-model";
import { GLYPH, PlusIcon, RefreshCwIcon } from "@repo/ui/icons";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { ActResult, ActVariables } from "./act.js";
import { sendAct } from "./act.js";
import { actMutation } from "./act-mutations.js";
import { sameAnswer, useConfirmAct } from "./confirm-act.js";
import { confirmFailure, refusedShown } from "./failure-report.js";
import { type GitHubConnectControl, useGitHubConnection } from "./github-connect.js";
import { GRANT_OUTCOME, grantedBySignIn, useIntegrationGrant } from "./integration-grant.js";
import type { IntegrationStatuses } from "./integration-statuses.js";
import { Highlighted } from "./search-field.js";
import { MenuRow } from "./settings/menu-row.js";

/**
 * integration-row.tsx -- one account's row at a provider, as every surface that connects an integration draws it: Settings › Integrations and setup's tools step alike.
 *
 * The row leads with the provider's mark, names the provider and, beside
 * it, the account where one is told apart (`serverAccountName`: "Notion ·
 * Acme"), and under it says where the connection stands once that needs
 * saying: connected, a sign-in the browser is waited on with Reopen and
 * Cancel, one that failed or never
 * finished with Try again, or one expired with Reconnect. A row with nothing
 * of that to say and not connected says instead what the provider gives
 * agents (`INTEGRATION_PURPOSE`), so a Connect is never pressed blind. A
 * connected or expired account's ⋯ keeps Reconnect (but where Reconnect is
 * the row's button), Disconnect (asked first), and, where the provider
 * allows, Add another account and Rename. Settings › Integrations' own words
 * (`settings/integrations-page.tsx`) say the rest of how a row behaves.
 */

/** The words a row says on its line and under it, fixed by the build. */
const ROW_LINE = {
  CONNECTED: INTEGRATION_STATUS_WORDS[INTEGRATION_STATUS.CONNECTED],
  CHECKING: "Checking…",
  TOOLS_NOT_READ: readFailedWords("the tools"),
  NOT_OPENED: "Your browser could not be opened to sign in. Try again.",
  GITHUB_SIGN_IN: "Uses your GitHub sign-in",
} as const;

/** What a row offers to mend its connection, on its button or in its ⋯. */
const ROW_ACT = {
  RECONNECT: "Reconnect",
  ADD_ACCOUNT: "Add another account",
  RENAME: "Rename",
} as const;

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

/** What a row's line looks like: connected with its dot, a problem in the attention tint, a wait with its ring, or plain. */
const LINE_STATE = {
  CONNECTED: "connected",
  ATTENTION: "attention",
  WAITING: "waiting",
  PLAIN: "plain",
} as const;

type LineState = (typeof LINE_STATE)[keyof typeof LINE_STATE];

/** How `@repo/ui`'s state line stands for each line, a wait and a plain line alike unmarked. */
const ROW_STATE: Record<LineState, SettingsRowState> = {
  [LINE_STATE.CONNECTED]: SETTINGS_ROW_STATE.CONNECTED,
  [LINE_STATE.ATTENTION]: SETTINGS_ROW_STATE.ATTENTION,
  [LINE_STATE.WAITING]: SETTINGS_ROW_STATE.PLAIN,
  [LINE_STATE.PLAIN]: SETTINGS_ROW_STATE.PLAIN,
};

/** The line under a row's name, and how it looks. */
interface RowLine {
  readonly text: string;
  readonly state: LineState;
  /** The server's or the sign-in's own words behind `text`, quoted and naming who said them, on a line of their own. */
  readonly said?: string;
}

/** Someone else's words behind a row's line, where there are any. */
function saidOf(said: string | undefined): Pick<RowLine, "said"> {
  return said === undefined ? {} : { said };
}

/** A connected row's line, from how its server answered. */
function connectedLine(health: ConnectionHealth): RowLine {
  switch (health.kind) {
    case CONNECTION_HEALTH.WORKING:
      return { text: ROW_LINE.CONNECTED, state: LINE_STATE.CONNECTED };
    case CONNECTION_HEALTH.BROKEN:
      return { text: health.problem, state: LINE_STATE.ATTENTION, ...saidOf(health.said) };
    case CONNECTION_HEALTH.CHECKING:
      return { text: ROW_LINE.CHECKING, state: LINE_STATE.PLAIN };
    case CONNECTION_HEALTH.FAILED:
      return { text: ROW_LINE.TOOLS_NOT_READ, state: LINE_STATE.ATTENTION };
  }
}

/** A sign-in's line: its wait with the ring, a failure in the attention tint, or one unfinished, plain. */
function signInRowLine(provider: IntegrationProvider, signIn: SignIn): RowLine {
  const { text, problem, said } = signInLine(provider, signIn);
  if (signIn.kind === SIGN_IN.WAITING) return { text, state: LINE_STATE.WAITING };
  return { text, state: problem ? LINE_STATE.ATTENTION : LINE_STATE.PLAIN, ...saidOf(said) };
}

/**
 * The line under a row's name: a sign-in the window waits on or last waited
 * on, else a sign-in that expired, or nothing where the row's own control
 * already says it — a Connect, or a row whose status has not been read. A
 * connection under way is a sign-in the window waits on, since a read that
 * finds one pending begins it, so it has no line of its own here. A
 * connection that stands outranks a sign-in, which a read that finds it
 * connected ends anyway.
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
    case INTEGRATION_STATUS.EXPIRED:
      return {
        text: INTEGRATION_STATUS_WORDS[INTEGRATION_STATUS.EXPIRED],
        state: LINE_STATE.ATTENTION,
      };
    case INTEGRATION_STATUS.PENDING:
    case INTEGRATION_STATUS.DISCONNECTED:
    case undefined:
    case INTEGRATION_STATUS.UNAVAILABLE:
      return undefined;
  }
}

/**
 * What a row's grant button says: Reconnect over a connection that broke,
 * GitHub's included, else Try again after a sign-in that did not connect,
 * else Connect or Reconnect.
 */
function grantLabel(status: IntegrationStatus | undefined, signIn: SignIn | undefined): string {
  if (status === INTEGRATION_STATUS.CONNECTED) return ROW_ACT.RECONNECT;
  if (signIn !== undefined) return SIGN_IN_ACTION.TRY_AGAIN;
  return status === INTEGRATION_STATUS.EXPIRED ? ROW_ACT.RECONNECT : "Connect";
}

/**
 * A row's line, with the ring before a wait's words, and where the server or
 * the sign-in said words of its own, those quoted on a plain line under ours.
 */
function RowLineText({ line }: { line: RowLine }): React.JSX.Element {
  const state = (
    <SettingsRowStateLine state={ROW_STATE[line.state]} block={line.said !== undefined}>
      {line.state === LINE_STATE.WAITING ? <SpinnerRing size={SPINNER_SIZE.SMALL} /> : null}
      {line.text}
    </SettingsRowStateLine>
  );
  if (line.said === undefined) return state;
  return (
    <>
      {state}
      <SettingsRowStateLine block>
        <ReplayMask>{line.said}</ReplayMask>
      </SettingsRowStateLine>
    </>
  );
}

/** The words a row marks where no search stands. */
const NO_TOKENS: readonly string[] = [];

/**
 * Disconnects one account: a Connect grant at the service, and GitHub by
 * unlinking the account's GitHub under the Mac's session, whose refusal is
 * the window's toast, so the dialog closes either way. Each answers once the
 * host's read carries where the account then stands, so an account past the
 * provider's first leaves the page with its row as the answer lands.
 */
function disconnectAccount(
  disconnectIntegration: (
    variables: ActVariables<typeof ACT_KIND.INTEGRATIONS_DISCONNECT>,
  ) => Promise<ActResult<typeof ACT_KIND.INTEGRATIONS_DISCONNECT>>,
  github: GitHubConnectControl,
  row: ServerRow,
): Promise<ActionResult> {
  const { provider, connection, name } = row;
  const refused: ActionResult = {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: `${name} could not be disconnected. Try again.`,
  };
  if (grantedBySignIn(provider)) return github.disconnect().then(() => ACCEPTED);
  return disconnectIntegration({
    provider,
    ...(connection === provider ? undefined : { connection }),
  }).then(
    (answer: IntegrationStatusView) => ("failure" in answer ? refused : ACCEPTED),
    () => refused,
  );
}

/** One account's row at a provider, or a provider's where the account holds none there. */
export function IntegrationRow({
  row,
  status,
  health,
  statuses,
  tokens = NO_TOKENS,
  onRetryTools,
}: {
  row: ServerRow;
  /** Where the connection stands, or nothing while it has not been read; the row offers nothing until it has. */
  status: IntegrationStatus | undefined;
  /** How a connected account's server answered when asked for its tools. */
  health: ConnectionHealth;
  statuses: IntegrationStatuses;
  /** The words a search asks for, marked where they landed in the row's name. */
  tokens?: readonly string[];
  /** Asks the account's server for its tools again, offered where the read failed. */
  onRetryTools: () => void;
}): React.JSX.Element {
  const { mutateAsync: sendIntegrationsRename } = useMutation(
    actMutation(ACT_KIND.INTEGRATIONS_RENAME),
  );
  const { provider, connection, name, account, accountName } = row;
  const { cancelSignIn } = statuses;
  const grant = useIntegrationGrant(statuses);
  const bySignIn = grantedBySignIn(provider);
  const github = useGitHubConnection();
  const signIn = statuses.signInOf(connection);
  const [connecting, setConnecting] = useState(false);
  // Note that the sign-in's own Cancel is the one busy while it is called off, as Connect is while one begins.
  const [canceling, setCanceling] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rejection, setRejection] = useState<string | undefined>(undefined);
  // Several accounts at a provider are each renamed, and each disconnected leaving the others.
  const several = row.accounts > 1 && account !== undefined;

  /** How a grant begun went, said under the row where it could not begin. */
  const began = (outcome: (typeof GRANT_OUTCOME)[keyof typeof GRANT_OUTCOME]) => {
    setConnecting(false);
    if (outcome === GRANT_OUTCOME.NOT_OPENED) setRejection(ROW_LINE.NOT_OPENED);
    if (outcome === GRANT_OUTCOME.REFUSED) {
      setRejection(`${name} could not be connected. Try again.`);
    }
  };

  const connect = useCallback(() => {
    setConnecting(true);
    setRejection(undefined);
    void grant.begin(connection).then(began);
  }, [grant, connection, name]);

  const addAccount = () => {
    setConnecting(true);
    setRejection(undefined);
    void grant.add(provider).then(began);
  };

  const cancel = useCallback(() => {
    setConnecting(true);
    setCanceling(true);
    setRejection(undefined);
    void cancelSignIn(connection).then((canceled) => {
      setConnecting(false);
      setCanceling(false);
      if (!canceled) setRejection(`The sign-in to ${name} could not be canceled. Try again.`);
    });
  }, [cancelSignIn, connection, name]);

  /** A rename ended: a new label asked of the service, which the host draws over its read on the press, so every surface draws it at once; a refusal puts the old one back and is said under the row. */
  const renamed = ({ value: label }: InlineEditEnd) => {
    setEditing(false);
    if (label === undefined || label === account?.label) return;
    setRejection(undefined);
    const refused = () => setRejection(`${name} could not be renamed. Try again.`);
    void sendIntegrationsRename({ provider, connection, label }).then((answer) => {
      if ("failure" in answer) refused();
    }, refused);
  };

  const connected = status === INTEGRATION_STATUS.CONNECTED;
  const expired = status === INTEGRATION_STATUS.EXPIRED;
  // An account the service still holds, connected or expired, is managed from its ⋯.
  const held = connected || expired;
  const disconnecting = useMutation({
    mutationKey: [ACT_KIND.INTEGRATIONS_DISCONNECT],
    mutationFn: () =>
      disconnectAccount(
        (variables) => sendAct(ACT_KIND.INTEGRATIONS_DISCONNECT, variables),
        github,
        row,
      ),
  });
  const disconnectAct = useConfirmAct(disconnecting, {
    send: () => disconnecting.mutateAsync(),
    answered: sameAnswer,
  });
  const disconnect = useConfirmDialog(
    { subject: held, surfaceOpen: true },
    disconnectAct,
    confirmFailure(FAILURE_SURFACE.INTEGRATION_DISCONNECT),
  );

  const line = rowLine(provider, status, health, signIn);
  const broken = connected && health.kind === CONNECTION_HEALTH.BROKEN && health.reconnect;
  const waiting = !connected && signIn?.kind === SIGN_IN.WAITING;
  // Whether the row offers its grant (Connect, Reconnect, or Try again) as
  // the button at its end, where a row not connected keeps its Connect.
  const granting =
    !waiting &&
    !(connected && health.kind === CONNECTION_HEALTH.FAILED) &&
    !(status === undefined || status === INTEGRATION_STATUS.UNAVAILABLE || (connected && !broken));
  // A broken or expired connection's Reconnect is the row's button, so its ⋯
  // keeps it only while the connection stands quiet.
  const reconnect = {
    label: ROW_ACT.RECONNECT,
    icon: <RefreshCwIcon />,
    disabled: connecting,
    onSelect: connect,
  };
  const leave = {
    label: "Disconnect",
    icon: <GLYPH.DISCONNECT />,
    danger: true,
    onSelect: disconnect.ask,
  };
  const naming = several
    ? [{ label: ROW_ACT.RENAME, icon: <GLYPH.RENAME />, onSelect: () => setEditing(true) }]
    : [];
  const adding =
    !bySignIn && statuses.canAdd(provider) && row.accounts < INTEGRATION_ACCOUNTS_MAX
      ? [
          {
            label: ROW_ACT.ADD_ACCOUNT,
            icon: <PlusIcon />,
            disabled: connecting,
            onSelect: addAccount,
          },
        ]
      : [];
  const actions = held
    ? [[...naming, ...adding], broken || expired ? [] : [reconnect], [leave]].filter(
        (group) => group.length > 0,
      )
    : [];
  return (
    // Note that a row is followed by its connection, because one that connects or disconnects leaves one section for the other and glides across rather than leaving one and arriving in the other.
    <Stack gap={GAP.NONE} {...motionKey(connection)}>
      <MenuRow
        thing={name}
        actions={actions}
        anchor={connection}
        {...(bySignIn ? { heading: ROW_LINE.GITHUB_SIGN_IN } : undefined)}
        row={{
          // Note that every row of a provider ends in a short button, a ⋯, or both, so on a narrow page each keeps its end beside its name and lets its words wrap, rather than one row dropping its end below them.
          controls: SETTINGS_ROW_CONTROLS.BESIDE,
          leading: (
            <SettingsRowMark>
              <ProviderMark provider={provider} />
            </SettingsRowMark>
          ),
          label: <Highlighted text={INTEGRATION_NAME[provider]} tokens={tokens} />,
          // Note that a rename edits the account's words in their place beside the provider's name, since the account is what it names.
          adornment:
            accountName === undefined ? undefined : (
              <InlineEdit
                value={account === undefined ? accountName : integrationAccountLabel(account)}
                label={`${name} account name`}
                editing={editing && account !== undefined}
                maxLength={INTEGRATION_LABEL_MAX}
                look={INLINE_EDIT_LOOK.INPUT}
                onEnd={renamed}
              >
                <AccountWords words={accountName}>
                  <ReplayMask>
                    <Highlighted text={accountName} tokens={tokens} />
                  </ReplayMask>
                </AccountWords>
              </InlineEdit>
            ),
          description:
            line === undefined ? (
              connected ? null : (
                INTEGRATION_PURPOSE[provider]
              )
            ) : (
              <RowLineText line={line} />
            ),
          error: refusedShown(rejection, FAILURE_SURFACE.INTEGRATION_RENAME),
          control: waiting ? (
            <>
              <Button
                variant={BUTTON_VARIANT.QUIET}
                busy={connecting && !canceling}
                busyLabel="Reopening the sign-in"
                disabled={canceling}
                onClick={connect}
              >
                {SIGN_IN_ACTION.REOPEN}
              </Button>
              <Button
                variant={BUTTON_VARIANT.OUTLINE}
                busy={canceling}
                busyLabel="Canceling the sign-in"
                disabled={connecting && !canceling}
                onClick={cancel}
              >
                {SIGN_IN_ACTION.CANCEL}
              </Button>
            </>
          ) : connected && health.kind === CONNECTION_HEALTH.FAILED ? (
            <RetryButton onRetry={onRetryTools} />
          ) : !granting ? null : (
            <Button
              variant={BUTTON_VARIANT.OUTLINE}
              // Note that the name starts with the words the button shows, so a voice command that says them finds it, and names the row, since several rows may offer the same words.
              label={`${grantLabel(status, signIn)} ${name}`}
              busy={connecting}
              busyLabel={`Connecting ${name}`}
              onClick={connect}
            >
              {grantLabel(status, signIn)}
            </Button>
          ),
        }}
      />
      <ConfirmDialog
        open
        confirm={disconnect}
        question={{
          title: `Disconnect ${name}?`,
          body: bySignIn
            ? "Agents lose GitHub until you connect it again."
            : several
              ? `Agents lose this account. Your other ${INTEGRATION_NAME[provider]} accounts stay connected.`
              : `Agents lose ${INTEGRATION_NAME[provider]} until you connect it again.`,
          verb: `Disconnect ${INTEGRATION_NAME[provider]}`,
          running: "Disconnecting",
          loss: CONFIRM_LOSS.AFFECTS_OTHERS,
          replayUnmasked: true,
          titleReplayMasked: true,
        }}
      />
    </Stack>
  );
}
