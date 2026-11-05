import { signedInAccountId } from "@repo/credentials/snapshot";
import { LIVE_READ } from "@repo/features/live-wire";
import { MCP_ACCESS_TOKEN_MINUTES, type McpClient } from "@repo/features/mcp-client-wire";
import { oauthRedirectDestination } from "@repo/features/oauth-consent";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readingWords } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { SETTINGS_SEARCH_ROW } from "@repo/settings/settings-anchors";
import {
  BUTTON_VARIANT,
  Button,
  CONFIRM_LOSS,
  COPY_FIELD_WIDTH,
  ConfirmDialog,
  CopyField,
  ErrorState,
  SETTINGS_SKELETON_CONTROL,
  SettingsLine,
  SettingsRow,
  SettingsSection,
  type SettingsSectionSkeletonShape,
  SettingsSectionsSkeleton,
  TIME_LOOK,
  Time,
  useConfirmDialog,
} from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useState } from "react";
import { useAct } from "../act.js";
import { copyThroughShell } from "../copy-feedback.js";
import { confirmFailure, refusedShown, unreadShown } from "../failure-report.js";
import { APP_SLICE, useAppSlice } from "../use-app-state.js";
import { HOST_READ_STATUS, useHostRead } from "../use-host-read.js";
import { replayMaskedError } from "./marks.js";

/**
 * mcp-clients-section.tsx -- Settings › MCP's outside MCP clients: the agents the account allowed in, each revoked from its row, and how to connect one.
 *
 * An agent that signs a member in to the MCP server (Claude Code, Codex,
 * Claude.ai, ChatGPT) holds the member's Allow from the consent page until
 * it is revoked. The page lists every one the account allowed, read by the
 * host while the page shows (`LIVE_READ.MCP_CLIENTS`): its name, where its
 * sign-in returns to as the consent page said it, when it was allowed, and
 * when it last refreshed its access. Revoke asks first in the confirm
 * dialog, then cuts the agent off: its next refresh is refused and its next
 * sign-in asks again, but an access token it already holds keeps working
 * until it expires, so a row revoked stays on the page saying so. A revoke
 * that did not finish says so under its row, which keeps its Revoke, since
 * an agent half revoked could sign in again without being asked.
 *
 * Under them, Connect an agent gives the server's address with its Copy,
 * drawn under its row at full width as each command is, and how each agent
 * this page knows adds it, as each agent's own docs say it: Claude Code and
 * Codex by a command, each with its Copy, and Claude.ai and ChatGPT through
 * their own settings.
 *
 * Each section is `@repo/ui`'s `SettingsSection` and each row its
 * `SettingsRow`, an address or a command its `CopyField`, and Revoke the
 * outline `Button`.
 */

const SECTION_TITLE = {
  CLIENTS: "Agents with access",
  CONNECT: "Connect an agent",
} as const;

/** The name each agent knows the server by in a command that adds it. */
const SERVER_NAME = PRODUCT_NAME.toLowerCase();

const PAGE_LINE = {
  READ_FAILED: "The agents with access could not be read.",
  NONE: "No agents yet.",
  UNNAMED: "Unnamed agent",
  SERVER: "Server URL",
  SERVER_WORDS: "Add this URL to any agent that supports remote MCP servers.",
  REVOKED: `Revoked. Its access ends within ${MCP_ACCESS_TOKEN_MINUTES} minutes.`,
} as const;

/** How one agent adds the server: the words a member follows, and the command where it takes one. */
interface ConnectStep {
  readonly name: string;
  readonly words: string;
  readonly command?: (serverUrl: string) => string;
}

/** Each agent this page knows, as its own docs say it adds a remote MCP server signed in with OAuth. */
const CONNECT_STEPS: readonly ConnectStep[] = [
  {
    name: "Claude Code",
    words: "Run this in a terminal, then type /mcp in Claude Code to sign in.",
    command: (serverUrl) => `claude mcp add --transport http ${SERVER_NAME} ${serverUrl}`,
  },
  {
    name: "Codex",
    words: `Run this in a terminal. It opens your browser to sign in, or run codex mcp login ${SERVER_NAME}.`,
    command: (serverUrl) => `codex mcp add ${SERVER_NAME} --url ${serverUrl}`,
  },
  {
    name: "Claude.ai",
    words:
      "In Customize › Connectors, choose Add custom connector, paste the server URL, then connect it. On a Team or Enterprise plan, an owner adds it in Organization settings › Connectors.",
  },
  {
    name: "ChatGPT",
    words:
      "In Plugins, choose + › Add custom MCP server, paste the server URL under Connection, then choose Create as a plugin.",
  },
];

/** How many agents stand as rows while the read is out. */
const CLIENT_SKELETON_ROWS = 1;

/**
 * The sections that stand while the agents are read: a row to each agent
 * likely, ending in its Revoke, and Connect an agent's rows, the address
 * first and then each step its declaration lists, each field under its row.
 */
const SECTIONS_SKELETON: readonly SettingsSectionSkeletonShape[] = [
  {
    headed: true,
    rows: Array.from({ length: CLIENT_SKELETON_ROWS }, () => ({
      described: true,
      controls: [SETTINGS_SKELETON_CONTROL.BUTTON],
    })),
  },
  {
    headed: true,
    rows: Array.from({ length: 1 + CONNECT_STEPS.length }, () => ({
      described: true,
      controls: [],
    })),
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

/** An agent's line: where it returns to, when it was allowed, and when it last refreshed, where it has. */
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
          {" · Refreshed "}
          <Time at={client.lastRefreshedAt} look={TIME_LOOK.AGO} />
        </>
      )}
    </>
  );
}

/** One agent the account allowed: its line and its Revoke, or, once revoked, how long what it holds lasts. */
function ClientRow({
  client,
  revoked,
  onRevoked,
}: {
  client: McpClient;
  revoked: boolean;
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

  return (
    <>
      <SettingsRow
        label={<ReplayMask>{name}</ReplayMask>}
        description={revoked ? PAGE_LINE.REVOKED : <ClientLine client={client} />}
        error={replayMaskedError(refusedShown(rejection, FAILURE_SURFACE.MCP_CLIENT_REVOKE))}
      >
        {() =>
          revoked ? null : (
            <Button variant={BUTTON_VARIANT.OUTLINE} onClick={confirm.ask}>
              Revoke
            </Button>
          )
        }
      </SettingsRow>
      <ConfirmDialog
        open
        confirm={confirm}
        question={{
          title: `Revoke ${name}?`,
          body: `${name} can no longer use your ${PRODUCT_NAME} account. Access it already holds stops working within ${MCP_ACCESS_TOKEN_MINUTES} minutes.`,
          verb: "Revoke agent",
          running: "Revoking",
          loss: CONFIRM_LOSS.AFFECTS_OTHERS,
          replayUnmasked: true,
          titleReplayMasked: true,
          bodyReplayMasked: true,
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

/** Connect an agent: the server's address with its Copy, and how each agent adds it. */
function ConnectSection({ serverUrl }: { serverUrl: string }): React.JSX.Element {
  return (
    <SettingsSection title={SECTION_TITLE.CONNECT} anchor={SETTINGS_SEARCH_ROW.MCP_CONNECT}>
      <SettingsRow
        label={PAGE_LINE.SERVER}
        description={PAGE_LINE.SERVER_WORDS}
        below={() => (
          <CopyField
            label={PAGE_LINE.SERVER}
            value={serverUrl}
            what="URL"
            copy={copyThroughShell}
            width={COPY_FIELD_WIDTH.FULL}
          />
        )}
      />
      {CONNECT_STEPS.map((step) => {
        const command = step.command?.(serverUrl);
        return (
          <SettingsRow
            key={step.name}
            label={step.name}
            description={step.words}
            {...(command === undefined
              ? undefined
              : {
                  below: () => (
                    <CopyField
                      label={`${step.name} command`}
                      value={command}
                      what="command"
                      copy={copyThroughShell}
                      width={COPY_FIELD_WIDTH.FULL}
                    />
                  ),
                })}
          />
        );
      })}
    </SettingsSection>
  );
}

/** The agents with access and Connect an agent, for the account signed in. */
export function McpClientsSections(): React.JSX.Element {
  const accountId = signedInAccountId(useAppSlice(APP_SLICE.ACCOUNT));
  const { rows, status, retry } = useHostRead(LIVE_READ.MCP_CLIENTS, accountId);
  // The agents revoked while the page shows, which stand saying so after the read no longer lists them.
  const [revoked, setRevoked] = useState<ReadonlyMap<string, McpClient>>(new Map());
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
        label={readingWords("the agents with access")}
        sections={SECTIONS_SKELETON}
      />
    );
  }
  const shown = shownClients(rows.clients, revoked);
  return (
    <>
      <SettingsSection title={SECTION_TITLE.CLIENTS} anchor={SETTINGS_SEARCH_ROW.MCP_CLIENTS}>
        {shown.length === 0 ? (
          <SettingsLine>{PAGE_LINE.NONE}</SettingsLine>
        ) : (
          shown.map((client) => (
            <ClientRow
              key={client.clientId}
              client={client}
              revoked={revoked.has(client.clientId)}
              onRevoked={(gone) => setRevoked((before) => new Map(before).set(gone.clientId, gone))}
            />
          ))
        )}
      </SettingsSection>
      <ConnectSection serverUrl={rows.serverUrl} />
    </>
  );
}
