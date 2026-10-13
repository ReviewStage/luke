import type { GitHubConnection } from "@sidecar/hosted/github-connection-wire";
import { GitHubMark } from "../account-marks";
import { CONNECT_GITHUB_LABEL } from "../planning/planning-model";
import { SettingsGroup } from "./settings-group";

/**
 * github-section.tsx -- Settings' GitHub row: whether the account has GitHub connected, and the way to connect or disconnect it.
 *
 * GitHub is connected apart from signing in, as an integration is. Both
 * Connect GitHub and Disconnect open a page of the service's in the
 * browser, where the change is made and confirmed, so neither asks here
 * first; the row reads the connection again once the window comes forward.
 * Until the first read lands the row offers Connect, since connecting an
 * account already connected only links the same GitHub again.
 */

/** What Settings' GitHub row is handed: the connection as last read, and the two pages. */
export interface GitHubSettingsControl {
  /** Whether the account has GitHub connected, and its login; absent before the first read lands. */
  connection: GitHubConnection | undefined;
  /** Opens the page that connects the account's GitHub in the browser. */
  onConnect: () => void;
  /** Opens the page that disconnects the account's GitHub in the browser. */
  onDisconnect: () => void;
}

/** What the row says the connection is. */
function connectionLine(connection: GitHubConnection | undefined): string {
  if (connection === undefined || !connection.connected) {
    return "Connect GitHub to choose repositories and start agents.";
  }
  return connection.login === null ? "Connected" : `Connected as ${connection.login}`;
}

export function GitHubSection({ control }: { control: GitHubSettingsControl }): React.JSX.Element {
  const connected = control.connection?.connected === true;
  return (
    <SettingsGroup title="GitHub">
      <div className="settings-row">
        <span className="account-avatar account-avatar-fallback" aria-hidden="true">
          <GitHubMark />
        </span>
        <span className="settings-copy">
          <strong>GitHub</strong>
          <small>{connectionLine(control.connection)}</small>
        </span>
        <button
          type="button"
          className="toolbar-button bordered-button"
          onClick={connected ? control.onDisconnect : control.onConnect}
        >
          {connected ? "Disconnect" : CONNECT_GITHUB_LABEL}
        </button>
      </div>
    </SettingsGroup>
  );
}
