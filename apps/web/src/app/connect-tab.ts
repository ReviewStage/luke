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
 * reach or navigate this tab, and marked as the connect's own hand-off;
 * the landing page says it came back, and that hand-off, on a broadcast
 * channel of this origin's instead, which this tab answers only for a
 * hand-off it made, and only until that connect is abandoned. Every other
 * address opens as a link, as before. An address of either kind opens only
 * where it is an http or https one, as the desktop's `web.open` takes it,
 * because any other would run as script on this origin or hand the address
 * to another app.
 *
 * Note that the presses' tabs are taken in the order pressed, not by which
 * act answered, because an address reaches here with nothing of the act it
 * answers; every tab is empty until one does, so which tab an address lands
 * in is never seen, and a press that opened nothing closes a tab no address
 * took.
 */

import { isWebAddress } from "@luke/host/acts";
import {
  type ActPortClient,
  actContract,
  INTEGRATION_ACT_KIND,
  TASKS_ACT_KIND,
  WORKSPACE_ACT_KIND,
} from "@luke/host/contract";
import {
  CONNECT_BOUND_MS,
  CONNECT_CHANNEL,
  CONNECT_SAID,
  forgetReturn,
  markHandoff,
  rememberReturn,
  saying,
} from "../connect-return";

/** What a connect reaches of a tab it opened: whether it is still open, its close, its address replaced, and its own session storage, which it keeps through the provider and back. */
export interface ConnectTab {
  readonly closed: boolean;
  readonly close: () => void;
  readonly location: { readonly replace: (url: string) => void };
  readonly sessionStorage: Pick<Storage, "setItem">;
}

/** What a connect needs of the browser: a tab of its own, this tab sent on, and where this tab stands. */
export interface ConnectBrowser {
  /** A new tab, empty, cut from this one; nothing where the browser refused it. */
  readonly openEmptyTab: () => ConnectTab | null;
  /** Sends this tab to the address. */
  readonly navigate: (url: string) => void;
  /** Takes `go`, a way out of this tab, once the panel's leave guard says to (`page-leave.ts`). */
  readonly leave: (go: () => void) => void;
  /** Where this tab stands, as a path with its query and fragment. */
  readonly address: () => string;
  /** Any other address, opened as every link is. */
  readonly openLink: (url: string) => void;
}

/** A connect's press as the browser answered it: the empty tab it opened, or nothing where it was refused, and the hand-off that tab is marked as. */
interface Press {
  readonly tab: ConnectTab | null;
  readonly handoff: string;
}

export interface ConnectTabs {
  /** The act port's client with each connect's press, the account's GitHub, an integration's, and a workspace's, opening its empty tab before the act goes out. */
  readonly portClient: (client: ActPortClient) => ActPortClient;
  /** Opens an address: in the oldest connect's tab while one waits, else as a link. */
  readonly open: (url: string) => void;
  /** Answers each landing page that came back from a connect this tab handed off, until the answer is called. */
  readonly listen: () => () => void;
}

export function connectTabs(browser: ConnectBrowser): ConnectTabs {
  // Note that presses wait in order, because two connects may be out at once and each answer takes the oldest tab.
  const waiting: Press[] = [];
  // When each connect this tab handed to a tab of its own was handed off, by the hand-off its tab is marked as, until its landing says so.
  const handedOff = new Map<string, number>();

  /** Lets go of every connect abandoned by now, whose landing is no longer this tab's to answer. */
  const dropAbandoned = (): void => {
    const now = Date.now();
    for (const [made, at] of handedOff) if (now - at > CONNECT_BOUND_MS) handedOff.delete(made);
  };

  /** A connect pressed: its empty tab opened at once, and closed where its act opened nothing. */
  const press = <A>(go: () => Promise<A>): Promise<A> => {
    const pressed: Press = { tab: browser.openEmptyTab(), handoff: crypto.randomUUID() };
    // Note that the tab is marked now, while it is still this origin's empty page and its storage this tab's to write.
    if (pressed.tab !== null) markHandoff(pressed.tab, pressed.handoff);
    waiting.push(pressed);
    return go().finally(() => {
      const left = waiting.indexOf(pressed);
      if (left === -1) return;
      // The act opened nothing, so its empty tab goes.
      waiting.splice(left, 1);
      pressed.tab?.close();
    });
  };

  // Note that the client is a proxy that lists no procedure, so each is read off it by the contract's own names.
  const portClient = (client: ActPortClient): ActPortClient => {
    const account = client[TASKS_ACT_KIND.GITHUB_CONNECT];
    const integration = client[INTEGRATION_ACT_KIND.INTEGRATIONS_CONNECT];
    const github = client[WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_CONNECT];
    const linear = client[WORKSPACE_ACT_KIND.WORKSPACE_LINEAR_CONNECT];
    // SAFETY: every procedure the contract names is read off the client, so this answers each one the client does.
    const procedures = Object.fromEntries(
      Object.keys(actContract).map((kind) => [kind, client[kind as keyof ActPortClient]]),
    ) as ActPortClient;
    return {
      ...procedures,
      [TASKS_ACT_KIND.GITHUB_CONNECT]: (...args: Parameters<typeof account>) =>
        press(() => account(...args)),
      [INTEGRATION_ACT_KIND.INTEGRATIONS_CONNECT]: (...args: Parameters<typeof integration>) =>
        press(() => integration(...args)),
      [WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_CONNECT]: (...args: Parameters<typeof github>) =>
        press(() => github(...args)),
      [WORKSPACE_ACT_KIND.WORKSPACE_LINEAR_CONNECT]: (...args: Parameters<typeof linear>) =>
        press(() => linear(...args)),
    };
  };

  const open = (url: string): void => {
    // Note that an address off the web opens nowhere and takes no press, so a press it answered closes its tab as its act ends.
    if (!isWebAddress(url)) {
      console.warn("An address that is not an http or https one was not opened.");
      return;
    }
    const press = waiting.shift();
    if (press === undefined) {
      browser.openLink(url);
      return;
    }
    if (press.tab === null) {
      browser.leave(() => {
        rememberReturn(browser.address());
        browser.navigate(url);
      });
      return;
    }
    // Note that a tab the developer closed before the address came opens nothing, because closing it said no.
    if (press.tab.closed) return;
    press.tab.location.replace(url);
    dropAbandoned();
    handedOff.set(press.handoff, Date.now());
  };

  /** Takes the hand-off a landing names, answering whether this tab made it and its connect is not yet abandoned. */
  const claim = (handoff: string): boolean => {
    dropAbandoned();
    return handedOff.delete(handoff);
  };

  const listen = (): (() => void) => {
    // The app standing in this tab again ends any same-tab connect that left from it.
    forgetReturn();
    // So does the browser bringing the page back from its cache, which runs nothing here again.
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) forgetReturn();
    };
    window.addEventListener("pageshow", restored);
    const channel = new BroadcastChannel(CONNECT_CHANNEL);
    channel.onmessage = (event) => {
      const landed = saying(event, CONNECT_SAID.LANDED);
      if (landed?.handoff === undefined || !claim(landed.handoff)) return;
      channel.postMessage({ kind: CONNECT_SAID.MINE, landing: landed.landing });
      window.focus();
    };
    return () => {
      channel.close();
      window.removeEventListener("pageshow", restored);
    };
  };

  return { portClient, open, listen };
}

/** The tab's own browser, as a connect reaches it. */
export function tabBrowser(
  openLink: (url: string) => void,
  leave: (go: () => void) => void,
): ConnectBrowser {
  return {
    openEmptyTab: () => {
      const tab = window.open("", "_blank");
      if (tab !== null) tab.opener = null;
      return tab;
    },
    navigate: (url) => location.assign(url),
    leave,
    address: () => `${location.pathname}${location.search}${location.hash}`,
    openLink,
  };
}
