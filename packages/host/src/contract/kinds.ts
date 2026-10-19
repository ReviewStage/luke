/**
 * kinds.ts -- the act kinds the window's act port answers, by domain, and the handshake that opens the port.
 *
 * Kept free of oRPC and of every schema, so `acts.ts` can spell these kinds
 * in `ACT_KIND` beside the ones `app:act` still carries without resolving the
 * contract behind them. A kind here is the key of its procedure in
 * `actContract`, so the panel's act door calls a kind by its own name.
 */

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

/**
 * A task's coding agents, the core of what the Tasks tab asks of them: the
 * models, the default, the lists, an agent started, read, messaged, changed,
 * and shown, and an agent's page.
 */
export const AGENT_ACT_KIND = {
  /**
   * A task's coding agents, asked of the service: the models one may run
   * on, the account's default among them read and written, the task's
   * agents with their status, one started under the press's own key, one's
   * transcript past a cursor (held open by the service while the agent
   * runs), one sent a message naming how it reaches a turn under way, one
   * given another model and effort for its next step, one renamed, one stopped, one
   * archived (a turn it still runs stopped first) or brought back. The
   * window holds what it draws; nothing here does.
   */
  CODING_AGENTS_MODELS: "codingAgents.models",
  CODING_AGENTS_DEFAULT_READ: "codingAgents.defaultRead",
  CODING_AGENTS_DEFAULT_WRITE: "codingAgents.defaultWrite",
  CODING_AGENTS_LIST: "codingAgents.list",
  /** One workspace's agents, newest started first: what an automation's Same agent is chosen from. */
  CODING_AGENTS_WORKSPACE_LIST: "codingAgents.workspaceList",
  CODING_AGENTS_START: "codingAgents.start",
  CODING_AGENTS_MESSAGES: "codingAgents.messages",
  CODING_AGENTS_MESSAGE: "codingAgents.message",
  CODING_AGENTS_CHOOSE: "codingAgents.choose",
  CODING_AGENTS_RENAME: "codingAgents.rename",
  CODING_AGENTS_SERVERS: "codingAgents.servers",
  CODING_AGENTS_STOP: "codingAgents.stop",
  CODING_AGENTS_ARCHIVE: "codingAgents.archive",
  CODING_AGENTS_PIN: "codingAgents.pin",
  /**
   * Which agent's tab the panel shows, or none, and which task's Inbox tab,
   * or none: what main's notification of an agent's end or of an inbox item
   * is held back by, and what clears an agent's tab's unseen dot.
   */
  CODING_AGENTS_SHOWN: "codingAgents.shown",
  CODING_AGENTS_PAGE: "codingAgents.page",
} as const;

/** The Issues page's asks: a workspace's issues listed, one read, one filed, and one changed. */
export const ISSUE_ACT_KIND = {
  ISSUES_LIST: "issues.list",
  ISSUES_READ: "issues.read",
  ISSUES_CREATE: "issues.create",
  ISSUES_CHANGE: "issues.change",
} as const;

/** Every kind the act port answers, one spread per domain, in alphabetical order. */
export const PORT_ACT_KIND = {
  ...ACCOUNT_ASK_ACT_KIND,
  ...AGENT_ACT_KIND,
  ...ISSUE_ACT_KIND,
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
