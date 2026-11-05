import { signedInAccountId } from "@repo/credentials/snapshot";
import { LIVE_READ } from "@repo/features/live-wire";
import { MCP_ACCESS_TOKEN_MINUTES, type McpClient } from "@repo/features/mcp-client-wire";
import { MODEL_PROVIDER } from "@repo/features/models-wire";
import { oauthRedirectDestination } from "@repo/features/oauth-consent";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readingWords } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { SETTINGS_SEARCH_ROW } from "@repo/settings/settings-anchors";
import {
  BUTTON_VARIANT,
  ButtonLink,
  CHOICE_BAR_LOOK,
  CHOICE_BAR_SIZE,
  ChoiceBar,
  CONFIRM_LOSS,
  COPY_FIELD_WIDTH,
  ConfirmDialog,
  CopyField,
  ErrorState,
  MARK_PROVIDER,
  ProviderMark,
  SETTINGS_ROW_STATE,
  SETTINGS_SKELETON_CONTROL,
  SettingsLine,
  SettingsRow,
  SettingsRowMark,
  SettingsRowStateLine,
  SettingsSection,
  type SettingsSectionSkeletonShape,
  SettingsSectionsSkeleton,
  TIME_LOOK,
  Time,
  useConfirmDialog,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ReplayMask, ReplayWords } from "@repo/ui/session-replay-marks";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useState } from "react";
import { useAct } from "../act.js";
import { copyThroughShell } from "../copy-feedback.js";
import { confirmFailure, refusedShown, unreadShown } from "../failure-report.js";
import { HarnessMark } from "../harness-marks.js";
import { linkPressOf, useOpenLink } from "../tasks/use-open-link.js";
import { APP_SLICE, useAppSlice } from "../use-app-state.js";
import { HOST_READ_STATUS, useHostRead } from "../use-host-read.js";
import { MenuRow } from "./menu-row.js";

/**
 * mcp-clients-section.tsx -- Settings › our MCP: the outside agents the account let in, each revoked from its row, and how to connect one.
 *
 * An agent that signs a member in to the MCP server (Claude Code, Codex,
 * Cursor, Claude, ChatGPT) holds the member's Allow from the consent page
 * until it is revoked. Connected lists every one the account allowed, read
 * by the host while the page shows and again whenever the window is focused
 * (`LIVE_READ.MCP_CLIENTS`): its name, where its sign-in returns to as the
 * consent page said it, when it was allowed, and when it last refreshed its
 * access. Its ⋯ holds Disconnect, as an integration's does, which
 * asks first in the confirm dialog, then cuts the agent off: its next
 * refresh is refused and its next sign-in asks again, but an access token it
 * already holds keeps working until it expires, so a row revoked stays on
 * the page saying so. A revoke that did not finish says so under its row,
 * which keeps its Disconnect, since an agent half revoked could sign in again
 * without being asked.
 *
 * Connect an agent asks which agent first, and then shows only that agent's
 * one step, as its own docs say it adds a remote MCP server signed in with
 * OAuth: Claude Code, Codex, and VS Code by a command with its Copy, Cursor
 * by its install link, Claude and ChatGPT by the server's address pasted in
 * their own settings, and any other agent by the address alone. An agent
 * that arrives while the page shows, which is how a member comes back from
 * the browser, lights its row and is said to be connected under the step.
 * While the account has none, Connect an agent stands first.
 *
 * Each agent is led by its brand's mark, in the picker and on its row, an
 * allowed agent's found by the name it registered under; Other stands in
 * the picker by its name alone, and a row whose agent the page does not
 * know wears a plain agent's glyph, so the rows' names stay in one column. Each section is `@repo/ui`'s
 * `SettingsSection`, the agent asked for its segmented `ChoiceBar`, each
 * allowed agent `MenuRow`'s row, and an address or a command its `CopyField`.
 */

const SECTION_TITLE = {
  CLIENTS: "Connected",
  CONNECT: "Connect an agent",
} as const;

/** The name each agent knows the server by in a command that adds it. */
const SERVER_NAME = PRODUCT_NAME.toLowerCase();

const PAGE_LINE = {
  READ_FAILED: "The connected agents could not be read.",
  NONE: "No agents connected yet.",
  UNNAMED: "Unnamed agent",
  AGENT: "Agent",
  SERVER: "Server URL",
  DISCONNECT: "Disconnect",
  REVOKED: `Disconnected. Its access ends within ${MCP_ACCESS_TOKEN_MINUTES} minutes.`,
} as const;

/** The agents Connect an agent knows, in the order it offers them, any other last. */
const CONNECT_AGENT = {
  CLAUDE_CODE: "claudeCode",
  CODEX: "codex",
  CURSOR: "cursor",
  VS_CODE: "vsCode",
  CLAUDE: "claude",
  CHATGPT: "chatgpt",
  OTHER: "other",
} as const;

type ConnectAgent = (typeof CONNECT_AGENT)[keyof typeof CONNECT_AGENT];

/**
 * How one agent adds the server, as its own docs say it: its step's words,
 * and the one thing the step hands over, a command to copy, the server's
 * address to copy, or a link that installs it.
 */
interface ConnectStep {
  readonly name: string;
  /** Its brand's mark; any other agent has none. */
  readonly mark?: React.JSX.Element;
  readonly label: string;
  readonly words: string;
  readonly command?: (serverUrl: string) => string;
  readonly address?: true;
  readonly install?: { readonly label: string; readonly url: (serverUrl: string) => string };
}

/** Cursor's install link for a remote server: its name and its config, `{ url }`, in base64 (cursor.com/docs/mcp/install-links). */
function cursorInstallUrl(serverUrl: string): string {
  const config = btoa(JSON.stringify({ url: serverUrl }));
  return `https://cursor.com/en/install-mcp?name=${SERVER_NAME}&config=${encodeURIComponent(config)}`;
}

/** Each agent's one step. */
const CONNECT_STEPS: Readonly<Record<ConnectAgent, ConnectStep>> = {
  [CONNECT_AGENT.CLAUDE_CODE]: {
    name: "Claude Code",
    mark: <HarnessMark provider={MODEL_PROVIDER.ANTHROPIC} />,
    label: "Run this in a terminal",
    words: `Then type /mcp in Claude Code, choose ${SERVER_NAME}, and sign in.`,
    command: (serverUrl) => `claude mcp add --transport http ${SERVER_NAME} ${serverUrl}`,
  },
  [CONNECT_AGENT.CODEX]: {
    name: "Codex",
    mark: <HarnessMark provider={MODEL_PROVIDER.OPENAI} />,
    label: "Run this in a terminal",
    words: `It opens your browser to sign in. If it doesn't, run codex mcp login ${SERVER_NAME}.`,
    command: (serverUrl) => `codex mcp add ${SERVER_NAME} --url ${serverUrl}`,
  },
  [CONNECT_AGENT.CURSOR]: {
    name: "Cursor",
    mark: <ProviderMark provider={MARK_PROVIDER.CURSOR} />,
    label: `Add ${PRODUCT_NAME} to Cursor`,
    words: `Then sign in to ${SERVER_NAME} from Cursor's MCP settings.`,
    install: { label: "Add to Cursor", url: cursorInstallUrl },
  },
  [CONNECT_AGENT.VS_CODE]: {
    name: "VS Code",
    mark: <ProviderMark provider={MARK_PROVIDER.VS_CODE} />,
    label: "Run this in a terminal",
    words: `Then start ${SERVER_NAME} from VS Code's MCP servers and sign in.`,
    command: (serverUrl) =>
      `code --add-mcp '${JSON.stringify({ name: SERVER_NAME, type: "http", url: serverUrl })}'`,
  },
  [CONNECT_AGENT.CLAUDE]: {
    name: "Claude",
    mark: <ProviderMark provider={MARK_PROVIDER.CLAUDE} />,
    label: "Copy the server URL",
    words:
      "In Claude, open Customize › Connectors, choose Add custom connector, paste it, then connect. On a Team or Enterprise plan, an owner adds it in Organization settings › Connectors.",
    address: true,
  },
  [CONNECT_AGENT.CHATGPT]: {
    name: "ChatGPT",
    mark: <ProviderMark provider={MARK_PROVIDER.CHATGPT} />,
    label: "Copy the server URL",
    words:
      "In ChatGPT, open Plugins, choose + › Add custom MCP server, paste it under Connection, then choose Create as a plugin.",
    address: true,
  },
  [CONNECT_AGENT.OTHER]: {
    name: "Other",
    label: PAGE_LINE.SERVER,
    words: "Add it to any agent that supports remote MCP servers. It signs in with OAuth.",
    address: true,
  },
};

/** The names an agent registers under where they are not the name the picker calls it by. */
const REGISTERED_AS: ReadonlyMap<string, ConnectAgent> = new Map([
  ["visual studio code", CONNECT_AGENT.VS_CODE],
]);

/** The mark an allowed agent's row leads with: its brand's, where the name it registered under is one the picker knows, or a plain agent's. */
function clientMark(client: McpClient): React.JSX.Element {
  const name = client.name?.trim().toLowerCase() ?? "";
  const agent =
    REGISTERED_AS.get(name) ??
    Object.values(CONNECT_AGENT).find((each) => CONNECT_STEPS[each].name.toLowerCase() === name);
  return (agent === undefined ? undefined : CONNECT_STEPS[agent].mark) ?? <GLYPH.AGENT />;
}

/** How many agents stand as rows while the read is out. */
const CLIENT_SKELETON_ROWS = 1;

/**
 * The sections that stand while the agents are read: a row to each agent
 * likely, ending in its ⋯, and Connect an agent's two rows, the agent asked
 * for and its step.
 */
const SECTIONS_SKELETON: readonly SettingsSectionSkeletonShape[] = [
  {
    headed: true,
    rows: Array.from({ length: CLIENT_SKELETON_ROWS }, () => ({
      described: true,
      controls: [SETTINGS_SKELETON_CONTROL.MORE],
    })),
  },
  {
    headed: true,
    rows: [
      { described: false, controls: [SETTINGS_SKELETON_CONTROL.CHOICE] },
      { described: true, controls: [] },
    ],
  },
];

/** What an agent is called on its row: the name it registered under, or a plain one where it gave none. */
function clientName(client: McpClient): string {
  return client.name ?? PAGE_LINE.UNNAMED;
}

/** Where an agent's sign-in returns to, as the consent page named it: each place once. */
function destinations(client: McpClient): string {
  return [...new Set(client.redirectUris.map(oauthRedirectDestination))].join(", ");
}

/** An agent's line: where it returns to, when it was allowed, and when it last refreshed its access, where it has. */
function ClientLine({ client }: { client: McpClient }): React.JSX.Element {
  return (
    <>
      Goes to <ReplayMask>{destinations(client)}</ReplayMask>
      {client.allowedAt === null ? null : (
        <>
          {" · Allowed "}
          <Time at={client.allowedAt} look={TIME_LOOK.PROVENANCE} />
        </>
      )}
      {client.lastRefreshedAt === null ? null : (
        <>
          {" · Active "}
          <Time at={client.lastRefreshedAt} look={TIME_LOOK.AGO} />
        </>
      )}
    </>
  );
}

/** One agent the account allowed: its line and its ⋯ holding Disconnect, or, once revoked, how long what it holds lasts. */
function ClientRow({
  client,
  revoked,
  arrived,
  onRevoked,
}: {
  client: McpClient;
  revoked: boolean;
  /** Whether it was allowed while the page showed, which lights its row once. */
  arrived: boolean;
  onRevoked: (client: McpClient) => void;
}): React.JSX.Element {
  const { act } = useAct();
  const name = clientName(client);
  const [rejection, setRejection] = useState<string | undefined>(undefined);

  const revoke = (): Promise<ActionResult> => {
    const refused: ActionResult = {
      status: ACTION_RESULT_STATUS.REJECTED,
      reason: `Revoking ${name} didn't finish. Try again.`,
    };
    setRejection(undefined);
    return act(ACT_KIND.MCP_CLIENTS_REVOKE, { clientId: client.clientId }).then(
      (answer): ActionResult => {
        if ("failure" in answer) {
          setRejection(refused.reason);
          return refused;
        }
        onRevoked(client);
        return { status: ACTION_RESULT_STATUS.ACCEPTED };
      },
      () => {
        setRejection(refused.reason);
        return refused;
      },
    );
  };
  const confirm = useConfirmDialog(
    { subject: !revoked, surfaceOpen: true },
    revoke,
    confirmFailure(FAILURE_SURFACE.MCP_CLIENT_REVOKE),
  );

  // Note that an agent that gave no name is called by the app's own words, which show in a screen recording.
  const named = client.name !== null && client.name !== undefined;
  return (
    <>
      <MenuRow
        thing={name}
        actions={
          revoked
            ? []
            : [
                {
                  label: PAGE_LINE.DISCONNECT,
                  icon: <GLYPH.DISCONNECT />,
                  danger: true,
                  onSelect: confirm.ask,
                },
              ]
        }
        row={{
          leading: <SettingsRowMark>{clientMark(client)}</SettingsRowMark>,
          label: <ReplayWords masked={named}>{name}</ReplayWords>,
          description: revoked ? PAGE_LINE.REVOKED : <ClientLine client={client} />,
          error: refusedShown(rejection, FAILURE_SURFACE.MCP_CLIENT_REVOKE),
          landed: arrived,
        }}
      />
      <ConfirmDialog
        open
        confirm={confirm}
        question={{
          title: `Disconnect ${name}?`,
          body: `${name} can no longer use your ${PRODUCT_NAME} account. Access it already holds stops working within ${MCP_ACCESS_TOKEN_MINUTES} minutes.`,
          verb: "Disconnect agent",
          running: "Disconnecting",
          loss: CONFIRM_LOSS.AFFECTS_OTHERS,
          replayUnmasked: true,
          titleReplayMasked: named,
          bodyReplayMasked: named,
        }}
      />
    </>
  );
}

/** The agents the account allowed, and those revoked while the page shows, in the order they were allowed, newest first. */
function shownClients(
  listed: readonly McpClient[],
  revoked: ReadonlyMap<string, McpClient>,
): readonly McpClient[] {
  const standing = listed.filter((client) => !revoked.has(client.clientId));
  return [...standing, ...revoked.values()].toSorted(
    (one, other) => (other.allowedAt ?? 0) - (one.allowedAt ?? 0),
  );
}

/** One agent's step: its words, and the command or address to copy, or the link that installs it. */
function ConnectStepRow({
  step,
  serverUrl,
}: {
  step: ConnectStep;
  serverUrl: string;
}): React.JSX.Element {
  const openLink = useOpenLink();
  const install = step.install;
  const installUrl = install?.url(serverUrl);
  const copied = step.command?.(serverUrl) ?? (step.address === true ? serverUrl : undefined);
  return (
    <SettingsRow
      label={step.label}
      description={step.words}
      {...(install === undefined || installUrl === undefined
        ? undefined
        : {
            children: () => (
              <ButtonLink
                variant={BUTTON_VARIANT.OUTLINE}
                href={installUrl}
                onClick={linkPressOf(openLink, installUrl)}
              >
                {install.label}
              </ButtonLink>
            ),
          })}
      {...(copied === undefined
        ? undefined
        : {
            below: () => (
              <CopyField
                label={step.command === undefined ? PAGE_LINE.SERVER : `${step.name} command`}
                value={copied}
                what={step.command === undefined ? "URL" : "command"}
                copy={copyThroughShell}
                width={COPY_FIELD_WIDTH.FULL}
              />
            ),
          })}
    />
  );
}

/** Connect an agent: which agent, that agent's one step, and the agent that just connected, once one has. */
function ConnectSection({
  serverUrl,
  arrived,
}: {
  serverUrl: string;
  arrived: McpClient | undefined;
}): React.JSX.Element {
  const [agent, setAgent] = useState<ConnectAgent>(CONNECT_AGENT.CLAUDE_CODE);
  return (
    <SettingsSection title={SECTION_TITLE.CONNECT} anchor={SETTINGS_SEARCH_ROW.MCP_CONNECT}>
      <SettingsRow
        label={PAGE_LINE.AGENT}
        below={() => (
          <ChoiceBar
            label={PAGE_LINE.AGENT}
            items={Object.values(CONNECT_AGENT).map((each) => ({
              value: each,
              label: CONNECT_STEPS[each].name,
              icon: CONNECT_STEPS[each].mark,
            }))}
            value={agent}
            look={CHOICE_BAR_LOOK.SEGMENTED}
            size={CHOICE_BAR_SIZE.COMPACT}
            onChange={setAgent}
          />
        )}
      />
      <ConnectStepRow step={CONNECT_STEPS[agent]} serverUrl={serverUrl} />
      {arrived === undefined ? null : (
        <SettingsLine>
          <SettingsRowStateLine state={SETTINGS_ROW_STATE.CONNECTED}>
            <ReplayWords masked={arrived.name !== null && arrived.name !== undefined}>
              {clientName(arrived)}
            </ReplayWords>{" "}
            is connected.
          </SettingsRowStateLine>
        </SettingsLine>
      )}
    </SettingsSection>
  );
}

/** The agents allowed and Connect an agent, for the account signed in. */
export function McpClientsSections(): React.JSX.Element {
  const accountId = signedInAccountId(useAppSlice(APP_SLICE.ACCOUNT));
  const { rows, status, retry } = useHostRead(LIVE_READ.MCP_CLIENTS, accountId);
  // The agents revoked while the page shows, which stand saying so after the read no longer lists them.
  const [revoked, setRevoked] = useState<ReadonlyMap<string, McpClient>>(new Map());
  // The agents the first read listed, so one allowed while the page shows is told apart as just connected.
  const [known, setKnown] = useState<ReadonlySet<string> | undefined>(undefined);
  if (rows !== undefined && known === undefined) {
    setKnown(new Set(rows.clients.map((client) => client.clientId)));
  }
  if (rows === undefined) {
    return status === HOST_READ_STATUS.FAILED ? (
      <SettingsSection title={SECTION_TITLE.CLIENTS} anchor={SETTINGS_SEARCH_ROW.MCP_CLIENTS}>
        <SettingsLine>
          <ErrorState failure={unreadShown(FAILURE_SURFACE.MCP_CLIENTS_READ)} onRetry={retry}>
            {PAGE_LINE.READ_FAILED}
          </ErrorState>
        </SettingsLine>
      </SettingsSection>
    ) : (
      <SettingsSectionsSkeleton
        label={readingWords("the connected agents")}
        sections={SECTIONS_SKELETON}
      />
    );
  }
  const shown = shownClients(rows.clients, revoked);
  const isNew = (client: McpClient) =>
    known !== undefined && !known.has(client.clientId) && !revoked.has(client.clientId);
  const clients = (
    <SettingsSection title={SECTION_TITLE.CLIENTS} anchor={SETTINGS_SEARCH_ROW.MCP_CLIENTS}>
      {shown.length === 0 ? (
        <SettingsLine>{PAGE_LINE.NONE}</SettingsLine>
      ) : (
        shown.map((client) => (
          <ClientRow
            key={client.clientId}
            client={client}
            revoked={revoked.has(client.clientId)}
            arrived={isNew(client)}
            onRevoked={(gone) => setRevoked((before) => new Map(before).set(gone.clientId, gone))}
          />
        ))
      )}
    </SettingsSection>
  );
  const connect = <ConnectSection serverUrl={rows.serverUrl} arrived={shown.find(isNew)} />;
  // Note that an account with no agent yet is led to connect one, rather than to an empty list.
  return shown.length === 0 ? (
    <>
      {connect}
      {clients}
    </>
  ) : (
    <>
      {clients}
      {connect}
    </>
  );
}
