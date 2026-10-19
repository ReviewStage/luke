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

/** The Automations pages' asks: the account's automations listed, made, changed, deleted, run now, and one's runs read. */
export const AUTOMATION_ACT_KIND = {
  AUTOMATIONS_LIST: "automations.list",
  AUTOMATIONS_CREATE: "automations.create",
  AUTOMATIONS_CHANGE: "automations.change",
  AUTOMATIONS_DELETE: "automations.delete",
  AUTOMATIONS_RUN: "automations.run",
  AUTOMATIONS_RUNS: "automations.runs",
  /** A webhook's secret minted again by the host and answered to this window alone, once, to show. */
  AUTOMATIONS_NEW_WEBHOOK_SECRET: "automations.newWebhookSecret",
} as const;

/**
 * Luke's avatar as the windows reach it: the panel's word on it, starting,
 * live on its first frame, or ended and why, taken from the panel alone; and
 * the video tile's Video off, Video on, and Restart video, Luke's avatar asked
 * for on the standing call or taken down, taken from the panel and the
 * floating call window, which draw the tile, alone.
 */
export const AVATAR_ACT_KIND = {
  AVATAR_REPORT: "avatar.report",
  VOICE_SET_VIDEO: "voice.setVideo",
} as const;

/** The Factory page's ask: a workspace's Factory world, read whole as it stands now. */
export const FACTORY_ACT_KIND = {
  FACTORY_WORLD: "factory.world",
} as const;

/**
 * Settings' integration rows: where every one of the account's integrations
 * stands, a browser sign-in to one begun and opened by the host, and one
 * connection ended. The window hears whether the browser was sent, never the
 * address it was sent to.
 */
export const INTEGRATION_ACT_KIND = {
  INTEGRATIONS_STATUS: "integrations.status",
  INTEGRATIONS_CONNECT: "integrations.connect",
  INTEGRATIONS_CANCEL: "integrations.cancel",
  INTEGRATIONS_DISCONNECT: "integrations.disconnect",
  /** The tools one account's server offers the account's agents, read from the service when a list of them is shown. */
  INTEGRATIONS_TOOLS: "integrations.tools",
  /** One account at a provider named as the developer calls it. */
  INTEGRATIONS_RENAME: "integrations.rename",
} as const;

/** The Issues page's asks: a workspace's issues listed, one read, one filed, and one changed. */
export const ISSUE_ACT_KIND = {
  ISSUES_LIST: "issues.list",
  ISSUES_READ: "issues.read",
  ISSUES_CREATE: "issues.create",
  ISSUES_CHANGE: "issues.change",
} as const;

/**
 * A coding agent's branch opened on this Mac (`@luke/features/mac-terminal-wire`):
 * each repository's run command read and set; and a terminal of this Mac
 * opened on the agent's branch for the asking panel, and closed with its
 * tab. What the terminal prints and what is typed travel on the port an open
 * posts to that panel, never on an act.
 */
export const MAC_TERMINAL_ACT_KIND = {
  MAC_REPOSITORIES: "macRepositories.read",
  MAC_REPOSITORY_SET: "macRepositories.set",
  MAC_TERMINAL_OPEN: "macTerminal.open",
  MAC_TERMINAL_CLOSE: "macTerminal.close",
} as const;

/**
 * A coding agent's Terminal tab (`messages/terminal.ts`): its shells listed,
 * started, named, and ended, its sandbox resumed on the developer's click,
 * and a shell attached and detached. What a shell prints travels on the port
 * an attach posts to the asking panel, never on an act.
 */
export const TERMINAL_ACT_KIND = {
  TERMINAL_LIST: "terminal.list",
  TERMINAL_CREATE: "terminal.create",
  TERMINAL_RENAME: "terminal.rename",
  TERMINAL_KILL: "terminal.kill",
  TERMINAL_RESUME: "terminal.resume",
  TERMINAL_ATTACH: "terminal.attach",
  TERMINAL_DETACH: "terminal.detach",
} as const;

/**
 * The voice window's runtime: a command to it from a panel or the call
 * window; the call card's way back, Luke's window brought forward on the
 * call's own task; the voice window as a GPT Live peer, its SDP offer handed
 * to the host, which creates the one session and answers the SDP, the
 * hang-up it asks the host to decide, and the two reports the host reads its
 * transport and its idle from, none carrying a credential; the stop key;
 * Stop Luke, on the task named, else the call's, else the open one; the
 * voice diagnostics; and the microphone's privacy settings opened.
 */
export const VOICE_RUNTIME_ACT_KIND = {
  VOICE_COMMAND: "voice.command",
  CALL_SHOW_TASK: "call.showTask",
  VOICE_CREATE_LIVE_SESSION: "voice.createLiveSession",
  VOICE_END_LIVE_SESSION: "voice.endLiveSession",
  VOICE_REPORT_LIVE_TRANSPORT: "voice.reportLiveTransport",
  VOICE_REPORT_LIVE_ACTIVITY: "voice.reportLiveActivity",
  VOICE_STOP_SPEAKING: "voice.stopSpeaking",
  LUKE_STOP: "luke.stop",
  VOICE_DIAGNOSTICS: "voice.diagnostics",
  MICROPHONE_OPEN_SETTINGS: "microphone.openSettings",
} as const;

/**
 * The account's workspaces: one made under a name, answered as made, which
 * the account owns; one renamed by its owners and admins, answered under
 * its new name; one's photo set as a `data:` URL or removed with null by
 * its owners and admins, answered with the photo's new version or none;
 * one's pending invitations read, one made, answered
 * with its accept link, and one canceled, for its owners and admins; a GitHub
 * organization connected to one, the Luke GitHub App's install address the
 * service answers opened in the browser, or disconnected from it; one
 * workspace's members read; one member removed, answered with the members
 * who remain; another member given a role, or the workspace handed to one
 * of its admins, by its owner, each answered with the members as they then
 * stand; and one workspace left. Every write reads the workspaces
 * again, so they arrive on the document; a write the account's role does
 * not allow is refused in words that say so. A workspace's photo is read
 * apart, answered with its bytes in base64 under its media type or why
 * there are none, since the document never carries them.
 */
export const WORKSPACE_ACT_KIND = {
  WORKSPACE_CREATE: "workspace.create",
  WORKSPACE_RENAME: "workspace.rename",
  WORKSPACE_INVITATIONS_READ: "workspace.invitationsRead",
  WORKSPACE_INVITE: "workspace.invite",
  WORKSPACE_INVITATION_CANCEL: "workspace.invitationCancel",
  WORKSPACE_GITHUB_CONNECT: "workspace.githubConnect",
  WORKSPACE_GITHUB_DISCONNECT: "workspace.githubDisconnect",
  WORKSPACE_LINEAR_CONNECT: "workspace.linearConnect",
  WORKSPACE_LINEAR_DISCONNECT: "workspace.linearDisconnect",
  WORKSPACE_LINEAR_ISSUES: "workspace.linearIssues",
  WORKSPACE_MEMBERS_READ: "workspace.membersRead",
  WORKSPACE_FORMER_MEMBERS_READ: "workspace.formerMembersRead",
  WORKSPACE_MEMBER_REMOVE: "workspace.memberRemove",
  WORKSPACE_MEMBER_ROLE: "workspace.memberRole",
  WORKSPACE_TRANSFER: "workspace.transfer",
  WORKSPACE_LEAVE: "workspace.leave",
  WORKSPACE_PHOTO_READ: "workspace.photoRead",
  WORKSPACE_PHOTO_SET: "workspace.photoSet",
} as const;

/** Every kind the act port answers, one spread per domain, in alphabetical order. */
export const PORT_ACT_KIND = {
  ...ACCOUNT_ASK_ACT_KIND,
  ...AUTOMATION_ACT_KIND,
  ...AVATAR_ACT_KIND,
  ...FACTORY_ACT_KIND,
  ...INTEGRATION_ACT_KIND,
  ...ISSUE_ACT_KIND,
  ...MAC_TERMINAL_ACT_KIND,
  ...TERMINAL_ACT_KIND,
  ...VOICE_RUNTIME_ACT_KIND,
  ...WORKSPACE_ACT_KIND,
} as const;

export type PortActKind = (typeof PORT_ACT_KIND)[keyof typeof PORT_ACT_KIND];

/**
 * The port kinds the platform shell answers itself, because they reach its
 * windows, ports, and system, one spread per domain, in alphabetical order;
 * the host's procedures answer every other.
 */
export const PLATFORM_PORT_ACT_KIND = {
  ...AVATAR_ACT_KIND,
  ...MAC_TERMINAL_ACT_KIND,
  ...TERMINAL_ACT_KIND,
  ...VOICE_RUNTIME_ACT_KIND,
} as const;

export type PlatformPortActKind =
  (typeof PLATFORM_PORT_ACT_KIND)[keyof typeof PLATFORM_PORT_ACT_KIND];

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
