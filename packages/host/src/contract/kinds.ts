/**
 * kinds.ts -- the act kinds the window's act port answers, by domain, and the handshake that opens the port.
 *
 * Kept free of oRPC and of every schema, so `acts.ts` can spell these kinds
 * in `ACT_KIND` beside the ones `app:act` still carries without resolving the
 * contract behind them. A kind here is the key of its procedure in
 * `actContract`, so the panel's act door calls a kind by its own name.
 */

/** The account's asks: a sign-in begun, begun again, or cancelled, a sign-out, and the account deleted. */
export const ACCOUNT_ACT_KIND = {
  ACCOUNT_BEGIN_SIGN_IN: "account.beginSignIn",
  ACCOUNT_SIGN_IN_AGAIN: "account.signInAgain",
  ACCOUNT_CANCEL_SIGN_IN: "account.cancelSignIn",
  ACCOUNT_SIGN_OUT: "account.signOut",
  ACCOUNT_DELETE: "account.delete",
} as const;

/**
 * The account's own asks from Settings and a dictating box: its provider keys,
 * its plan template and that template's history, and a dictated clip's words.
 */
export const ACCOUNT_ASK_ACT_KIND = {
  /**
   * Settings › API keys: the account's own provider keys read as hints and
   * statuses, one saved, one removed. The save's payload is the one place a
   * key crosses from the renderer, once, on its way to the service; no
   * answer carries one back, and nothing on the way keeps it.
   */
  PROVIDER_KEYS_READ: "providerKeys.read",
  PROVIDER_KEYS_SAVE: "providerKeys.save",
  PROVIDER_KEYS_REMOVE: "providerKeys.remove",
  /**
   * Settings › Plan template: the Markdown the account's new tasks start
   * from, read as the page opens, and kept as the developer pauses or reset
   * to the default with null. Each answers the template as the service then
   * keeps it. Its version history reads a page of revisions and one
   * revision at a time, and a restore answers the template as a write does.
   */
  PLAN_TEMPLATE_READ: "planTemplate.read",
  PLAN_TEMPLATE_WRITE: "planTemplate.write",
  PLAN_TEMPLATE_REVISIONS: "planTemplate.revisions",
  PLAN_TEMPLATE_REVISION: "planTemplate.revision",
  PLAN_TEMPLATE_RESTORE: "planTemplate.restore",
  /**
   * A clip dictated into a message box, carried once from the panel that
   * recorded it to the service and answered with its words. Nothing on the
   * way keeps it.
   */
  DICTATION_TRANSCRIBE: "dictation.transcribe",
} as const;

/** The Issues page's asks: a workspace's issues listed, one read, one filed, and one changed. */
export const ISSUE_ACT_KIND = {
  ISSUES_LIST: "issues.list",
  ISSUES_READ: "issues.read",
  ISSUES_CREATE: "issues.create",
  ISSUES_CHANGE: "issues.change",
} as const;

/** The settings writes: one setting, a page's settings reset, and one experiment turned on or off, each answering the settings as they then stand. */
export const SETTINGS_ACT_KIND = {
  SETTING_UPDATE: "setting.update",
  SETTINGS_RESET: "settings.reset",
  EXPERIMENT_SET: "experiment.set",
} as const;

/** Every kind the act port answers, one spread per domain, in alphabetical order. */
export const PORT_ACT_KIND = {
  ...ACCOUNT_ACT_KIND,
  ...ACCOUNT_ASK_ACT_KIND,
  ...ISSUE_ACT_KIND,
  ...SETTINGS_ACT_KIND,
} as const;

export type PortActKind = (typeof PORT_ACT_KIND)[keyof typeof PORT_ACT_KIND];

/**
 * The handshake that hands a window's act port to main, as oRPC's Electron
 * adapter has it: the page posts one end of a channel to its own window with
 * `REQUEST`, and the preload forwards it to main on `CHANNEL`.
 */
export const ACT_PORT = {
  REQUEST: "luke:act-port",
  CHANNEL: "app:act-port",
} as const;

/** A window message as the preload hears it: what was posted, by whom, and the ports it carried. */
export interface ActPortMessage<Port, Source> {
  readonly data: unknown;
  readonly source: Source | null;
  readonly ports: readonly Port[];
}

/**
 * The preload's listener for the page's act port: the first port the page
 * posts to itself with the handshake is forwarded to main, and every later
 * one is ignored, so one page holds one port for its life. A reload runs the
 * preload again, and the new page forwards its own.
 */
export function actPortForwarder<Port, Source>(
  self: Source,
  forward: (port: Port) => void,
): (message: ActPortMessage<Port, Source>) => void {
  let forwarded = false;
  return (message) => {
    if (forwarded || message.source !== self || message.data !== ACT_PORT.REQUEST) return;
    const [port] = message.ports;
    if (port === undefined) return;
    forwarded = true;
    forward(port);
  };
}
