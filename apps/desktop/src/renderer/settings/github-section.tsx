import type { GitHubConnection } from "@sidecar/hosted/github-connection-wire";
import { TrashIcon } from "@sidecar/panel";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { CONNECT_GITHUB_LABEL } from "../planning/planning-model";
import { SETTINGS_SECTION } from "../settings-views";
import { ConfirmDialog, useConfirmDialog } from "./confirm-dialog";
import { MenuRow } from "./menu-row";
import { SettingsGroup } from "./settings-group";

/**
 * github-section.tsx -- Settings' Connected accounts: whether the account has its own GitHub connected, and the way to connect or disconnect it.
 *
 * GitHub is connected apart from signing in, as an integration is. Connect
 * GitHub opens a page of the service's in the browser, where the link is
 * made and confirmed, so it asks nothing here first; the row reads the
 * connection again once the window comes forward. A connected row offers
 * Reconnect, since linking the same GitHub again renews an authorization
 * GitHub revoked or let lapse, which the row cannot see, and Disconnect in
 * its ⋯, which asks first, as an integration's does, because agents and
 * GitHub's integration lose GitHub with it. Until the first read lands the
 * row says it is checking and still offers Connect GitHub, since connecting
 * an account already connected only links the same GitHub again. It does
 * not hold the page back as a read in flight does, because a read the
 * service did not answer leaves no answer, and the rest of Account must not
 * wait on it.
 */

/** What Settings' GitHub row is handed: the connection as last read, and the two pages. */
export interface GitHubSettingsControl {
  /** Whether the account has GitHub connected, and its login; absent before the first read lands. */
  connection: GitHubConnection | undefined;
  /** Opens the page that connects the account's GitHub in the browser. */
  onConnect: () => void;
  /** Disconnects the account's GitHub, under the Mac's own session. */
  onDisconnect: () => void;
}

export function GitHubSection({ control }: { control: GitHubSettingsControl }): React.JSX.Element {
  const connected = control.connection?.connected === true;
  const disconnect = useConfirmDialog({ subject: connected, surfaceOpen: true }, () => {
    // A refusal is the window's toast, as Settings' Connect GitHub's is.
    control.onDisconnect();
    return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
  });
  const actions = connected
    ? [{ label: "Disconnect", icon: <TrashIcon />, danger: true, onSelect: disconnect.ask }]
    : [];
  return (
    <SettingsGroup title="Connected accounts" anchor={SETTINGS_SECTION.CONNECTED_ACCOUNTS}>
      <MenuRow label="GitHub actions" actions={actions}>
        <span className="settings-copy">
          <strong>GitHub</strong>
          {/* The service holds no login, so the row names none. */}
          <small>
            {control.connection === undefined
              ? "Checking…"
              : connected
                ? "Connected"
                : "Not connected"}
          </small>
        </span>
        <button
          type="button"
          className="toolbar-button bordered-button"
          onClick={control.onConnect}
        >
          {connected ? "Reconnect" : CONNECT_GITHUB_LABEL}
        </button>
      </MenuRow>
      <ConfirmDialog
        confirm={disconnect}
        question={{
          title: "Disconnect GitHub?",
          body: "Coding agents and GitHub's integration lose GitHub until you connect it again.",
          verb: "Disconnect",
          running: "Disconnecting",
        }}
      />
    </SettingsGroup>
  );
}
