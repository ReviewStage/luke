/**
 * capabilities.ts -- what the platform a client runs on offers, which decides the settings pages, rows, and shortcuts of each platform feature that stand.
 */

/**
 * What the platform this client runs on offers, each the controls the panel
 * draws for it only where it stands. Whether the platform offers a feature is
 * all this says: whether the account may use it is the feature's own fact
 * (`update.installSupported`, the `macCommands` setting), read beside it.
 */
export const HOST_CAPABILITY = {
  /** The Updates row and the sidebar's update button. */
  UPDATES: "updates",
  /** The microphone's permission and the route it is opened on. */
  MICROPHONE: "microphone",
  /** `run_on_mac`, and the This Mac page that turns it on. */
  MAC_COMMANDS: "macCommands",
  /** A local agent's Terminal, which opens the Mac's own Terminal in its worktree. */
  MAC_TERMINAL: "macTerminal",
  /** An agent's Terminal tab, and Show terminal and New terminal that open it. */
  TERMINALS: "terminals",
  /** A cloud agent's Local tab: shells on this Mac in the agent's mirrored files. */
  LOCAL_TERMINALS: "localTerminals",
  /** Forward to localhost, which listens on the machine's own loopback for an agent's cloud ports. */
  PORT_FORWARDS: "portForwards",
  /** Install command-line tool, which runs the `vespin` command's install script in the account of the machine the client runs on. */
  CLI_INSTALL: "cliInstall",
  /**
   * An app installed on the machine rather than a page in a browser tab:
   * the window's zoom, opening at login, the menu bar whose chords the
   * Keyboard shortcuts page lists, and the machine's own name over the pages
   * that are this client's alone.
   */
  DESKTOP_APP: "desktopApp",
} as const;

export type HostCapability = (typeof HOST_CAPABILITY)[keyof typeof HOST_CAPABILITY];
