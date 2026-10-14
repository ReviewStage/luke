import type { GitHubConnection } from "@sidecar/hosted/github-connection-wire";
import { CONNECT_GITHUB_LABEL } from "../planning/planning-model";
import { SETTINGS_SECTION } from "../settings-views";
import { SettingsGroup } from "./settings-group";

/**
 * github-section.tsx -- Settings' Connected accounts: whether the account has its own GitHub connected, and the way to connect or disconnect it.
 *
 * GitHub is connected apart from signing in, as an integration is. Both
 * Connect GitHub and Disconnect open a page of the service's in the
 * browser, where the change is made and confirmed, so neither asks here
 * first; the row reads the connection again once the window comes forward.
 * Until the first read lands the row offers Connect, since connecting an
 * account already connected only links the same GitHub again. A connected
 * row offers Reconnect beside Disconnect for the same reason: linking the
 * same GitHub again renews an authorization GitHub revoked or let lapse,
 * which the row cannot see, since it reads only that one is linked.
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
  return (
    <SettingsGroup title="Connected accounts" anchor={SETTINGS_SECTION.CONNECTED_ACCOUNTS}>
      <div className="settings-row">
        <span className="settings-copy">
          <strong>GitHub</strong>
          {/* The service holds no login, so the row names none. */}
          <small>{connected ? "Connected" : "Not connected"}</small>
        </span>
        <span className="settings-actions">
          <button
            type="button"
            className="toolbar-button bordered-button"
            onClick={control.onConnect}
          >
            {connected ? "Reconnect" : CONNECT_GITHUB_LABEL}
          </button>
          {connected && (
            <button
              type="button"
              className="toolbar-button bordered-button"
              onClick={control.onDisconnect}
            >
              Disconnect
            </button>
          )}
        </span>
      </div>
    </SettingsGroup>
  );
}
