/**
 * connect-tab.ts -- a connect's address opened in a tab the press itself opened, since the service names it only once asked, and in this tab, coming back through its landing, where the browser refused one.
 *
 * A connect (an integration's sign-in, the account's GitHub, a workspace's
 * GitHub or Linear) asks the service for the address to open, and the
 * browser lets a page open a tab only within a moment of a press, which the
 * answer may arrive after. So the press opens an empty tab at once, while
 * it still may, and the address lands in that tab when it comes, keeping
 * the developer's place here. Where the browser refused even that tab, the
 * address opens in this one, leaving where it stood with the landing page
 * the connect ends on (`connect-return.ts`), which offers the way back to
 * it. A press whose act opened nothing closes its empty tab. The tab is
 * cut from this one before it is sent anywhere, so no provider page can
 * reach or navigate this tab; the landing page says it came back on a
 * broadcast channel of this origin's instead, which this tab answers for
 * each connect it handed off. Every other address opens as a link, as
 * before.
 *
 * Note that the presses' tabs are taken in the order pressed, not by which
 * act answered, because an address reaches here with nothing of the act it
 * answers; every tab is empty until one does, so which tab an address lands
 * in is never seen, and a press that opened nothing closes a tab no address
 * took.
 */

import { ACT_KIND, type ActKind } from "@luke/host/acts";
import type { AppBridge } from "@luke/host/bridge";
import {
  type ActPortClient,
  actContract,
  INTEGRATION_ACT_KIND,
  WORKSPACE_ACT_KIND,
} from "@luke/host/contract";
import {
  CONNECT_CHANNEL,
  CONNECT_SAID,
  forgetReturn,
  landingSaying,
  rememberReturn,
} from "../connect-return";

/** The acts on the bridge that end by opening an address the service answered, which no press can open itself. */
const CONNECT_KINDS: ReadonlySet<ActKind> = new Set([ACT_KIND.GITHUB_CONNECT]);

/** What a connect reaches of a tab it opened: whether it is still open, its close, and its address replaced. */
export interface ConnectTab {
  readonly closed: boolean;
  readonly close: () => void;
  readonly location: { readonly replace: (url: string) => void };
}

/** What a connect needs of the browser: a tab of its own, this tab sent on, and where this tab stands. */
export interface ConnectBrowser {
  /** A new tab, empty, cut from this one; nothing where the browser refused it. */
  readonly openEmptyTab: () => ConnectTab | null;
  /** Sends this tab to the address. */
  readonly navigate: (url: string) => void;
  /** Where this tab stands, as a path with its query and fragment. */
  readonly address: () => string;
  /** Any other address, opened as every link is. */
  readonly openLink: (url: string) => void;
}

/** A connect's press as the browser answered it: the empty tab it opened, or nothing where it was refused. */
interface Press {
  readonly tab: ConnectTab | null;
}

export interface ConnectTabs {
  /** The bridge with each connect's press opening its empty tab before the act goes out. */
  readonly bridge: (bridge: AppBridge) => AppBridge;
  /** The act port's client with each integration's and workspace's connect press doing the same. */
  readonly portClient: (client: ActPortClient) => ActPortClient;
  /** Opens an address: in the oldest connect's tab while one waits, else as a link. */
  readonly open: (url: string) => void;
  /** Answers each landing page that came back from a connect this tab handed off, until the answer is called. */
  readonly listen: () => () => void;
}

export function connectTabs(browser: ConnectBrowser): ConnectTabs {
  // Note that presses wait in order, because two connects may be out at once and each answer takes the oldest tab.
  const waiting: Press[] = [];
  // How many connects this tab handed to a tab of their own whose landing has not yet said so.
  let handedOff = 0;

  /** A connect pressed: its empty tab opened at once, and closed where its act opened nothing. */
  const press = <A>(go: () => Promise<A>): Promise<A> => {
    const pressed: Press = { tab: browser.openEmptyTab() };
    waiting.push(pressed);
    return go().finally(() => {
      const left = waiting.indexOf(pressed);
      if (left === -1) return;
      // The act opened nothing, so its empty tab goes.
      waiting.splice(left, 1);
      pressed.tab?.close();
    });
  };

  const bridge = (inner: AppBridge): AppBridge => ({
    ...inner,
    act: (act) => (CONNECT_KINDS.has(act.kind) ? press(() => inner.act(act)) : inner.act(act)),
  });

  // Note that the client is a proxy that lists no procedure, so each is read off it by the contract's own names.
  const portClient = (client: ActPortClient): ActPortClient => {
    const integration = client[INTEGRATION_ACT_KIND.INTEGRATIONS_CONNECT];
    const github = client[WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_CONNECT];
    const linear = client[WORKSPACE_ACT_KIND.WORKSPACE_LINEAR_CONNECT];
    // SAFETY: every procedure the contract names is read off the client, so this answers each one the client does.
    const procedures = Object.fromEntries(
      Object.keys(actContract).map((kind) => [kind, client[kind as keyof ActPortClient]]),
    ) as ActPortClient;
    return {
      ...procedures,
      [INTEGRATION_ACT_KIND.INTEGRATIONS_CONNECT]: (...args: Parameters<typeof integration>) =>
        press(() => integration(...args)),
      [WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_CONNECT]: (...args: Parameters<typeof github>) =>
        press(() => github(...args)),
      [WORKSPACE_ACT_KIND.WORKSPACE_LINEAR_CONNECT]: (...args: Parameters<typeof linear>) =>
        press(() => linear(...args)),
    };
  };

  const open = (url: string): void => {
    const press = waiting.shift();
    if (press === undefined) {
      browser.openLink(url);
      return;
    }
    if (press.tab === null) {
      rememberReturn(browser.address());
      browser.navigate(url);
      return;
    }
    // Note that a tab the developer closed before the address came opens nothing, because closing it said no.
    if (press.tab.closed) return;
    press.tab.location.replace(url);
    handedOff += 1;
  };

  const listen = (): (() => void) => {
    // The app standing in this tab again ends any same-tab connect that left from it.
    forgetReturn();
    const channel = new BroadcastChannel(CONNECT_CHANNEL);
    channel.onmessage = (event) => {
      const landing = landingSaying(event, CONNECT_SAID.LANDED);
      if (landing === undefined || handedOff === 0) return;
      handedOff -= 1;
      channel.postMessage({ kind: CONNECT_SAID.MINE, landing });
      window.focus();
    };
    return () => channel.close();
  };

  return { bridge, portClient, open, listen };
}

/** The tab's own browser, as a connect reaches it. */
export function tabBrowser(openLink: (url: string) => void): ConnectBrowser {
  return {
    openEmptyTab: () => {
      const tab = window.open("", "_blank");
      if (tab !== null) tab.opener = null;
      return tab;
    },
    navigate: (url) => location.assign(url),
    address: () => `${location.pathname}${location.search}${location.hash}`,
    openLink,
  };
}
