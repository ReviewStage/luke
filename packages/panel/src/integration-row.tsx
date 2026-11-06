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

/**
 * integration-row.tsx -- one account's row at a provider, as every surface that connects an integration draws it: Settings › Integrations and setup's tools step alike.
 *
 * The row leads with the provider's mark, names the provider and, beside
 * it, the account where one is told apart (`serverAccountName`: "Notion ·
 * Acme"), and under it says where the connection stands once that needs
 * saying: connected with the count of its server's tools, a sign-in the
 * browser is waited on with Reopen and Cancel, one that failed or never
 * finished with Try again, or one expired with Reconnect. A row with nothing
 * of that to say and not connected says instead what the provider gives
 * agents (`INTEGRATION_PURPOSE`), so a Connect is never pressed blind. Its
 * ⋯ keeps Reconnect, Disconnect (asked first), and, where the provider
 * allows, Add another account and Rename. A surface that hands it the server's
 * tools (`tools`) lets the row open onto them in place; one that hands none
 * says their count alone. Settings › Integrations' own words
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

/** What mends a row's connection, pressed on its line after the words saying what went wrong. */
interface LineAct {
  readonly label: string;
  /** What the press is named, beginning with the words it shows. */
  readonly name: string;
  readonly onPress: () => void;
}

/**
 * A row's line, with the ring before a wait's words, and where the server or
 * the sign-in said words of its own, those quoted on a plain line under ours.
 * Where the row's mend stands on its line (`act`), it follows our words as a
 * press of its own words, so the row's end keeps to its ⋯ and a narrow row
 * never drops a button under its words.
 */
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

/** How a row's tools are drawn: which of them, whether they show, and the search that chose them. */
interface RowTools {
  /** The tools the row opens onto: every one, or those the search found. */
  readonly shown: readonly IntegrationTool[];
  /** Every tool its server answered with; the row opens onto none when none. */
  readonly all: readonly IntegrationTool[];
  /** The search found some of its tools, which are those shown. */
  readonly found: boolean;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  /** The words searched, marked where they landed. */
  readonly tokens: readonly string[];
}

/** The words a row marks where no search stands. */
const NO_TOKENS: readonly string[] = [];

/** The body a row's tools hand the fold their chevron reads, which the row's `Reveal` unrolls instead. */
const NO_BODY = (): void => undefined;

/** The fold state the tools' chevron turns by: open while they show, with the press the row's own. */
function toolsFold(tools: RowTools): DisclosureState {
  return {
    open: tools.expanded,
    drawn: tools.expanded,
    leaving: false,
    toggle: tools.onToggle,
    body: NO_BODY,
  };
}

/**
 * A connected row's line once its server answered with tools: Connected,
 * and the count of them as the press that opens the row onto them, its
 * chevron turning while they unroll.
 */
function ToolsLine({
  name,
  panelId,
  tools,
}: {
  name: string;
  panelId: string;
  tools: RowTools;
}): React.JSX.Element {
  // Note that the name starts with the words the press shows, so a voice command that says them finds it.
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

/** A row's tools, opened in place under it: the list, and beside it the page of the tool it holds. */
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
  // Note that a catalog integration's tools are named and described by the provider, which a screen recording shows; Executor's are the apps a member set up, which stay masked.
  const toolWordsShown = provider !== INTEGRATION_PROVIDER.EXECUTOR;
  // Note that the row's name is the provider's own unless an account's label rides it.
  const serverReplayMasked = name !== INTEGRATION_NAME[provider];
  const shown = byName(tools.shown);
  const [held, setHeld] = useState<string | undefined>(undefined);
  const rows = useRef(new Map<string, HTMLElement>());
  const body = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const run = useRef<VirtualRowsHandle>(null);
  // A tool the search no longer finds hands its place to the first that it does.
  const current = shown.find((tool) => tool.name === held) ?? shown[0];

  const hold = (tool: IntegrationTool | undefined) => {
    if (tool === undefined) return;
    setHeld(tool.name);
    const row = rows.current.get(tool.name);
    row?.focus({ preventScroll: true });
    keepInView(list.current, row?.closest("li") ?? null);
  };

  // The list's own arrows move the focus (`List`), and the tool held follows it, as a press on a row holds it.
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
    // Note that Escape stops here, because it hands the focus back to the list rather than leaving Settings.
    event.preventDefault();
    event.stopPropagation();
    if (current === undefined) return;
    const row = rows.current.get(current.name);
    // Note that the tool held may have been scrolled out of the rows drawn, so it is brought in first.
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
          // Note that a tool held is a page of its own, so it opens at its top rather than where the last was scrolled.
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
  tools,
  onRetryTools,
}: {
  row: ServerRow;
  /** Where the connection stands, or nothing while it has not been read; the row offers nothing until it has. */
  status: IntegrationStatus | undefined;
  /** How a connected account's server answered when asked for its tools. */
  health: ConnectionHealth;
  statuses: IntegrationStatuses;
  /** The server's tools the row opens onto in place; a surface that hands none says their count alone. */
  tools?: RowTools | undefined;
  /** Asks the account's server for its tools again, offered where the read failed. */
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
    // Note that a mend pressed on the row's line shows no wait of its own, so a second press while the first begins is dropped here.
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
  // Whether the row offers its grant (Connect, Reconnect, or Try again), and
  // whether that stands on its line: a row whose line says what went wrong
  // mends it there, and only a row with no line, a Connect, keeps a button.
  const granting =
    !waiting &&
    !(connected && health.kind === CONNECTION_HEALTH.FAILED) &&
    !(status === undefined || status === INTEGRATION_STATUS.UNAVAILABLE || (connected && !broken));
  const mendOnLine = granting && line !== undefined;
  // A broken connection's Reconnect is the row's button, so its ⋯ keeps it
  // only while the connection stands quiet.
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
    // Note that a row is followed by its connection, because one that connects or disconnects leaves one section for the other and glides across rather than leaving one and arriving in the other.
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
