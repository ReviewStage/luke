import { isWebAddress } from "@repo/host/acts";
import {
  type ActPortClient,
  actContract,
  INTEGRATION_ACT_KIND,
  TASKS_ACT_KIND,
  WORKSPACE_ACT_KIND,
} from "@repo/host/contract";
import {
  CONNECT_BOUND_MS,
  CONNECT_CHANNEL,
  CONNECT_SAID,
  forgetReturn,
  markHandoff,
  rememberReturn,
  saying,
} from "../connect-return";
import { addressHere } from "./web-address";

export interface ConnectTab {
  readonly closed: boolean;
  readonly close: () => void;
  readonly location: { readonly replace: (url: string) => void };
  readonly sessionStorage: Pick<Storage, "setItem">;
}

export interface ConnectBrowser {
  readonly openEmptyTab: () => ConnectTab | null;
  readonly navigate: (url: string) => void;
  readonly leave: (go: () => void) => void;
  readonly address: () => string;
  readonly openLink: (url: string) => void;
}

interface Press {
  readonly tab: ConnectTab | null;
  readonly handoff: string;
}

export interface ConnectTabs {
  readonly portClient: (client: ActPortClient) => ActPortClient;
  readonly open: (url: string) => void;
  readonly listen: () => () => void;
}

export function connectTabs(browser: ConnectBrowser): ConnectTabs {
  const waiting: Press[] = [];
  const handedOff = new Map<string, number>();

  const dropAbandoned = (): void => {
    const now = Date.now();
    for (const [made, at] of handedOff) if (now - at > CONNECT_BOUND_MS) handedOff.delete(made);
  };

  const press = <A>(go: () => Promise<A>): Promise<A> => {
    const pressed: Press = { tab: browser.openEmptyTab(), handoff: crypto.randomUUID() };
    if (pressed.tab !== null) markHandoff(pressed.tab, pressed.handoff);
    waiting.push(pressed);
    return go().finally(() => {
      const left = waiting.indexOf(pressed);
      if (left === -1) return;
      waiting.splice(left, 1);
      pressed.tab?.close();
    });
  };

  const portClient = (client: ActPortClient): ActPortClient => {
    const account = client[TASKS_ACT_KIND.GITHUB_CONNECT];
    const integration = client[INTEGRATION_ACT_KIND.INTEGRATIONS_CONNECT];
    const github = client[WORKSPACE_ACT_KIND.WORKSPACE_GITHUB_CONNECT];
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
    };
  };

  const open = (url: string): void => {
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
    if (press.tab.closed) return;
    press.tab.location.replace(url);
    dropAbandoned();
    handedOff.set(press.handoff, Date.now());
  };

  const claim = (handoff: string): boolean => {
    dropAbandoned();
    return handedOff.delete(handoff);
  };

  const listen = (): (() => void) => {
    forgetReturn();
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
    address: addressHere,
    openLink,
  };
}
