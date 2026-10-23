/**
 * port-channels.ts -- the channels main posts a window a `MessagePort` on: an attached shell's, a terminal of this Mac's, and a cloud Browser tab's live view's.
 *
 * The preload hands each port into its page by these names, the way Electron
 * hands a port to an isolated world, and the page reads it back by the same
 * name. They stand apart from the acts and wires that say what travels on
 * each port (`terminal-acts.ts`, `mac-terminal-wire.ts`, `browser-live-acts.ts`)
 * because those declare Schemas, and the preload, which runs before every
 * window's page, must not evaluate `effect` for three strings.
 */

/** The channel each attached shell's port is posted on. */
export const TERMINAL_PORT_CHANNEL = "terminal:port";

/** The channel a terminal of this Mac's port is posted to its panel on, under its agent's id. */
export const MAC_TERMINAL_PORT_CHANNEL = "mac-terminal:port";

/** The channel each attached cloud Browser view's port is posted on. */
export const BROWSER_LIVE_PORT_CHANNEL = "browser-live:port";
