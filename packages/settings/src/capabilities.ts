/**
 * capabilities.ts -- what the platform a client runs on offers, which decides the settings pages, rows, and shortcuts of each platform feature that stand.
 */

/**
 * What the platform this client runs on offers, each the controls the panel
 * draws for it only where it stands. Whether the platform offers a feature is
 * all this says: whether the account may use it is the feature's own fact
 * (`settings.status.voiceAvailable`, `update.installSupported`, the
 * `macCommands` setting), read beside it.
 */
export const HOST_CAPABILITY = {
  /** Talking to Luke: the call bar, the Voice page, and the Call group's chords. */
  VOICE: "voice",
  /** The Updates row and the sidebar's update button. */
  UPDATES: "updates",
  /** The microphone's permission and the route it is opened on. */
  MICROPHONE: "microphone",
  /** The system's notifications and the page that tests them. */
  NOTIFICATIONS: "notifications",
  /** `run_on_mac`, and the This Mac page that turns it on. */
  MAC_COMMANDS: "macCommands",
  /** This Mac's repositories and the Mac terminal tab that runs them. */
  MAC_TERMINAL: "macTerminal",
  /** An agent's Terminal tab, and Show terminal and New terminal that open it. */
  TERMINALS: "terminals",
  /** A Browser tab, whose page a view of the client's own draws over the panel. */
  BROWSER: "browser",
  /**
   * An app installed on the machine rather than a page in a browser tab:
   * the window's zoom, opening at login, the menu bar whose chords the
   * Keyboard shortcuts page lists, and the machine's own name over the pages
   * that are this client's alone.
   */
  DESKTOP_APP: "desktopApp",
} as const;

export type HostCapability = (typeof HOST_CAPABILITY)[keyof typeof HOST_CAPABILITY];
