import {
  CONNECTION_HEALTH,
  type ConnectionHealth,
  type IntegrationTool,
  toolsCount,
} from "@repo/features/integration-health";
import {
  SIGN_IN,
  SIGN_IN_ACTION,
  type SignIn,
  signInLine,
} from "@repo/features/integration-sign-in";
import { INTEGRATION_STATUS_WORDS } from "@repo/features/integration-status-words";
import { byName } from "@repo/features/integration-tool-model";
import type { IntegrationStatusView } from "@repo/features/integration-view";
import {
  INTEGRATION_ACCOUNTS_MAX,
  INTEGRATION_LABEL_MAX,
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER,
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
  DisclosureChevron,
  DisclosureScope,
  type DisclosureState,
  GAP,
  INLINE_EDIT_LOOK,
  InlineEdit,
  type InlineEditEnd,
  motionKey,
  ProviderMark,
  RetryButton,
  Reveal,
  revealArea,
  ScrollArea,
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
import type { VirtualRowsHandle } from "@repo/ui/virtual-rows";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useId, useRef, useState } from "react";
import type { ActResult, ActVariables } from "./act.js";
import { sendAct } from "./act.js";
import { actMutation } from "./act-mutations.js";
import { sameAnswer, useConfirmAct } from "./confirm-act.js";
import { confirmFailure, refusedShown } from "./failure-report.js";
import { type GitHubConnectControl, useGitHubConnection } from "./github-connect.js";
import { GRANT_OUTCOME, grantedBySignIn, useIntegrationGrant } from "./integration-grant.js";
import type { IntegrationStatuses } from "./integration-statuses.js";
import { IntegrationToolDetail, IntegrationToolList, keepInView } from "./integration-tool-list.js";
import { Highlighted } from "./search-field.js";
import { MenuRow } from "./settings/menu-row.js";

const ROW_LINE = {
  CONNECTED: INTEGRATION_STATUS_WORDS[INTEGRATION_STATUS.CONNECTED],
  CHECKING: "Checking…",
  TOOLS_NOT_READ: readFailedWords("the tools"),
  NOT_OPENED: "Your browser could not be opened to sign in. Try again.",
  GITHUB_SIGN_IN: "Uses your GitHub sign-in",
} as const;

const ROW_ACT = {
  RECONNECT: "Reconnect",
  ADD_ACCOUNT: "Add another account",
  RENAME: "Rename",
} as const;

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

const LINE_STATE = {
  CONNECTED: "connected",
  ATTENTION: "attention",
  WAITING: "waiting",
  PLAIN: "plain",
} as const;

type LineState = (typeof LINE_STATE)[keyof typeof LINE_STATE];

const ROW_STATE: Record<LineState, SettingsRowState> = {
  [LINE_STATE.CONNECTED]: SETTINGS_ROW_STATE.CONNECTED,
  [LINE_STATE.ATTENTION]: SETTINGS_ROW_STATE.ATTENTION,
  [LINE_STATE.WAITING]: SETTINGS_ROW_STATE.PLAIN,
  [LINE_STATE.PLAIN]: SETTINGS_ROW_STATE.PLAIN,
};

interface RowLine {
  readonly text: string;
  readonly state: LineState;
  readonly said?: string;
}

function saidOf(said: string | undefined): Pick<RowLine, "said"> {
  return said === undefined ? {} : { said };
}

function connectedLine(health: ConnectionHealth): RowLine {
  switch (health.kind) {
    case CONNECTION_HEALTH.WORKING:
      return {
        text: `${ROW_LINE.CONNECTED} · ${toolsCount(health.tools.length)}`,
        state: LINE_STATE.CONNECTED,
      };
    case CONNECTION_HEALTH.BROKEN:
      return { text: health.problem, state: LINE_STATE.ATTENTION, ...saidOf(health.said) };
    case CONNECTION_HEALTH.CHECKING:
      return { text: ROW_LINE.CHECKING, state: LINE_STATE.PLAIN };
    case CONNECTION_HEALTH.FAILED:
      return { text: ROW_LINE.TOOLS_NOT_READ, state: LINE_STATE.ATTENTION };
  }
}

function signInRowLine(provider: IntegrationProvider, signIn: SignIn): RowLine {
  const { text, problem, said } = signInLine(provider, signIn);
  if (signIn.kind === SIGN_IN.WAITING) return { text, state: LINE_STATE.WAITING };
  return { text, state: problem ? LINE_STATE.ATTENTION : LINE_STATE.PLAIN, ...saidOf(said) };
}

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

function grantLabel(status: IntegrationStatus | undefined, signIn: SignIn | undefined): string {
  if (status === INTEGRATION_STATUS.CONNECTED) return ROW_ACT.RECONNECT;
  if (signIn !== undefined) return SIGN_IN_ACTION.TRY_AGAIN;
  return status === INTEGRATION_STATUS.EXPIRED ? ROW_ACT.RECONNECT : "Connect";
}

interface LineAct {
  readonly label: string;
  readonly name: string;
  readonly onPress: () => void;
}

function RowLineText({
  line,
  act,
}: {
  line: RowLine;
  act?: LineAct | undefined;
}): React.JSX.Element {
  const state = (
    <SettingsRowStateLine
      state={ROW_STATE[line.state]}
      block={line.said !== undefined}
      wrap={act !== undefined}
    >
      {line.state === LINE_STATE.WAITING ? <SpinnerRing size={SPINNER_SIZE.SMALL} /> : null}
      {act === undefined ? line.text : `${line.text} · `}
      {act === undefined ? null : (
        <TextButton aria-label={act.name} onClick={act.onPress}>
          {act.label}
        </TextButton>
      )}
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

interface RowTools {
  readonly shown: readonly IntegrationTool[];
  readonly all: readonly IntegrationTool[];
  readonly found: boolean;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly tokens: readonly string[];
}

const NO_TOKENS: readonly string[] = [];

const NO_BODY = (): void => undefined;

function toolsFold(tools: RowTools): DisclosureState {
  return {
    open: tools.expanded,
    drawn: tools.expanded,
    leaving: false,
    toggle: tools.onToggle,
    body: NO_BODY,
  };
}

function ToolsLine({
  name,
  panelId,
  tools,
}: {
  name: string;
  panelId: string;
  tools: RowTools;
}): React.JSX.Element {
  const shown = tools.found
    ? `${tools.shown.length} of ${toolsCount(tools.all.length)} match`
    : toolsCount(tools.all.length);
  return (
    <SettingsRowStateLine state={SETTINGS_ROW_STATE.CONNECTED} wrap>
      {`${ROW_LINE.CONNECTED} · `}
      <TextButton
        aria-label={`${shown}, ${tools.expanded ? "hide" : "show"} ${name} tools`}
        aria-expanded={tools.expanded}
        aria-controls={tools.expanded ? panelId : undefined}
        onClick={tools.onToggle}
      >
        {shown}
        <DisclosureScope state={toolsFold(tools)}>
          <DisclosureChevron />
        </DisclosureScope>
      </TextButton>
    </SettingsRowStateLine>
  );
}

function RowToolsPanel({
  id,
  name,
  provider,
  tools,
}: {
  id: string;
  name: string;
  provider: IntegrationProvider;
  tools: RowTools;
}): React.JSX.Element {
  const toolWordsShown = provider !== INTEGRATION_PROVIDER.EXECUTOR;
  const serverReplayMasked = name !== INTEGRATION_NAME[provider];
  const shown = byName(tools.shown);
  const [held, setHeld] = useState<string | undefined>(undefined);
  const rows = useRef(new Map<string, HTMLElement>());
  const body = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const run = useRef<VirtualRowsHandle>(null);
  const current = shown.find((tool) => tool.name === held) ?? shown[0];

  const hold = (tool: IntegrationTool | undefined) => {
    if (tool === undefined) return;
    setHeld(tool.name);
    const row = rows.current.get(tool.name);
    row?.focus({ preventScroll: true });
    keepInView(list.current, row?.closest("li") ?? null);
  };

  const onRowFocus = (event: React.FocusEvent) => {
    const stepped = [...rows.current].some(([, row]) => row === event.relatedTarget);
    const landed = [...rows.current].find(([, row]) => row === event.target);
    if (!stepped || landed === undefined) return;
    setHeld(landed[0]);
    keepInView(list.current, landed[1].closest("li"));
  };

  const onRowKey = (event: React.KeyboardEvent<HTMLElement>, tool: IntegrationTool) => {
    if (event.key !== "Enter" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setHeld(tool.name);
    body.current?.focus();
  };

  const onBodyKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    event.stopPropagation();
    if (current === undefined) return;
    const row = rows.current.get(current.name);
    if (row !== undefined) row.focus({ preventScroll: true });
    else run.current?.bringIn(current.name, () => rows.current.get(current.name)?.focus());
  };

  return (
    <div id={id} className="integration-tools-panel">
      <div className="integration-tools-split">
        <ScrollArea ref={list}>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: the focus is the rows' own, which the box only hears bubble. */}
          <div className="integration-tools-list p-ui-4" onFocus={onRowFocus}>
            <IntegrationToolList
              scroller={list}
              handle={run}
              server={name}
              toolWordsShown={toolWordsShown}
              tools={shown}
              tokens={tools.tokens}
              current={current?.name}
              onOpen={hold}
              onKeyDown={onRowKey}
              rowRef={(tool, button) => {
                if (button === null) rows.current.delete(tool.name);
                else rows.current.set(tool.name, button);
              }}
            />
          </div>
        </ScrollArea>
        {current !== undefined ? (
          <IntegrationToolDetail
            key={current.name}
            server={name}
            serverReplayMasked={serverReplayMasked}
            toolWordsShown={toolWordsShown}
            tool={current}
            tokens={tools.tokens}
            bodyRef={body}
            onBodyKeyDown={onBodyKey}
          />
        ) : null}
      </div>
    </div>
  );
}

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

export function IntegrationRow({
  row,
  status,
  health,
  statuses,
  tools,
  onRetryTools,
}: {
  row: ServerRow;
  status: IntegrationStatus | undefined;
  health: ConnectionHealth;
  statuses: IntegrationStatuses;
  tools?: RowTools | undefined;
  onRetryTools: () => void;
}): React.JSX.Element {
  const panelId = useId();
  const { mutateAsync: sendIntegrationsRename } = useMutation(
    actMutation(ACT_KIND.INTEGRATIONS_RENAME),
  );
  const tokens = tools?.tokens ?? NO_TOKENS;
  const { provider, connection, name, account, accountName } = row;
  const { cancelSignIn } = statuses;
  const grant = useIntegrationGrant(statuses);
  const bySignIn = grantedBySignIn(provider);
  const github = useGitHubConnection();
  const signIn = statuses.signInOf(connection);
  const [connecting, setConnecting] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rejection, setRejection] = useState<string | undefined>(undefined);
  const several = row.accounts > 1 && account !== undefined;

  const began = (outcome: (typeof GRANT_OUTCOME)[keyof typeof GRANT_OUTCOME]) => {
    setConnecting(false);
    if (outcome === GRANT_OUTCOME.NOT_OPENED) setRejection(ROW_LINE.NOT_OPENED);
    if (outcome === GRANT_OUTCOME.REFUSED) {
      setRejection(`${name} could not be connected. Try again.`);
    }
  };

  const connect = useCallback(() => {
    if (connecting) return;
    setConnecting(true);
    setRejection(undefined);
    void grant.begin(connection).then(began);
  }, [connecting, grant, connection, name]);

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
    { subject: connected, surfaceOpen: true },
    disconnectAct,
    confirmFailure(FAILURE_SURFACE.INTEGRATION_DISCONNECT),
  );

  const line = rowLine(provider, status, health, signIn);
  const broken = connected && health.kind === CONNECTION_HEALTH.BROKEN && health.reconnect;
  const waiting = !connected && signIn?.kind === SIGN_IN.WAITING;
  const granting =
    !waiting &&
    !(connected && health.kind === CONNECTION_HEALTH.FAILED) &&
    !(status === undefined || status === INTEGRATION_STATUS.UNAVAILABLE || (connected && !broken));
  const mendOnLine = granting && line !== undefined;
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
  const actions = connected
    ? [[...naming, ...adding], broken ? [] : [reconnect], [leave]].filter(
        (group) => group.length > 0,
      )
    : [];
  return (
    <Stack gap={GAP.NONE} {...motionKey(connection)} {...revealArea()}>
      <MenuRow
        thing={name}
        actions={actions}
        anchor={connection}
        {...(bySignIn ? { heading: ROW_LINE.GITHUB_SIGN_IN } : undefined)}
        row={{
          leading: (
            <SettingsRowMark>
              <ProviderMark provider={provider} />
            </SettingsRowMark>
          ),
          label: <Highlighted text={INTEGRATION_NAME[provider]} tokens={tokens} />,
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
            connected && tools !== undefined && tools.all.length > 0 ? (
              <ToolsLine name={name} panelId={panelId} tools={tools} />
            ) : line === undefined ? (
              connected ? null : (
                INTEGRATION_PURPOSE[provider]
              )
            ) : (
              <RowLineText
                line={line}
                act={
                  mendOnLine
                    ? {
                        label: grantLabel(status, signIn),
                        name: `${grantLabel(status, signIn)} ${name}`,
                        onPress: connect,
                      }
                    : undefined
                }
              />
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
          ) : !granting || mendOnLine ? null : (
            <Button
              variant={BUTTON_VARIANT.OUTLINE}
              busy={connecting}
              busyLabel="Connecting"
              onClick={connect}
            >
              {grantLabel(status, signIn)}
            </Button>
          ),
        }}
      />
      {tools === undefined ? null : (
        <Reveal shown={connected && tools.expanded && tools.shown.length > 0}>
          <RowToolsPanel id={panelId} name={name} provider={provider} tools={tools} />
        </Reveal>
      )}
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
