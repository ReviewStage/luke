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

/** The Issues page's asks: a workspace's issues listed, one read, one filed, and one changed. */
export const ISSUE_ACT_KIND = {
  ISSUES_LIST: "issues.list",
  ISSUES_READ: "issues.read",
  ISSUES_CREATE: "issues.create",
  ISSUES_CHANGE: "issues.change",
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
  ...ISSUE_ACT_KIND,
  ...WORKSPACE_ACT_KIND,
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
