// @vitest-environment jsdom
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import type { AppBridge } from "@luke/host/bridge";
import { afterEach, expect, test } from "vitest";
import { type ConnectBrowser, type ConnectTab, connectTabs } from "../src/app/connect-tab";
import { CONNECT_RETURN, connectReturn } from "../src/connect-return";

/**
 * connect-tab.test.ts -- a connect's address, which the service answers only
 * after the press, lands in the tab the press opened, so the developer keeps
 * their place; where the browser refused that tab, it opens in this one,
 * leaving the address it stood at for the landing page's way back; a press
 * whose act opened nothing leaves no empty tab behind, even where another
 * press's act answered first.
 */

/** The address the service answers a connect with. */
const PROVIDER_ADDRESS = "https://provider.example/oauth/authorize";

/** A tab the browser opened: where it was sent, and whether it closed. */
interface OpenedTab {
  readonly window: ConnectTab;
  readonly sentTo: () => string | undefined;
  readonly closed: () => boolean;
}

function openedTab(): OpenedTab {
  let sentTo: string | undefined;
  let closed = false;
  const window: ConnectTab = {
    get closed() {
      return closed;
    },
    close: () => {
      closed = true;
    },
    location: {
      replace: (url: string) => {
        sentTo = url;
      },
    },
  };
  return { window, sentTo: () => sentTo, closed: () => closed };
}

/** The browser as a connect meets it: tabs it opens or refuses, and where this tab and each link were sent. */
function fakeBrowser(options: { readonly refusesTabs: boolean }) {
  const tabs: OpenedTab[] = [];
  const navigated: string[] = [];
  const links: string[] = [];
  const browser: ConnectBrowser = {
    openEmptyTab: () => {
      if (options.refusesTabs) return null;
      const tab = openedTab();
      tabs.push(tab);
      return tab.window;
    },
    navigate: (url) => navigated.push(url),
    address: () => "/plan/4f0b6a0e?tab=agents#settings",
    openLink: (url) => links.push(url),
  };
  return { browser, tabs, navigated, links };
}

const DONE: ActOutcome = { status: ACT_OUTCOME_STATUS.DONE, value: undefined };

/** The host behind the bridge: each act answers once the service has, opening the address it answered where it opens one. */
function hostBridge(open: (url: string) => void, opens: boolean): AppBridge {
  // SAFETY: the connect wraps the bridge's `act` alone and hands every other door through untouched.
  return {
    act: async (_act: Act) => {
      await Promise.resolve();
      if (opens) open(PROVIDER_ADDRESS);
      return DONE;
    },
  } as AppBridge;
}

const CONNECT: Act = { kind: ACT_KIND.GITHUB_CONNECT };

afterEach(() => {
  sessionStorage.clear();
});

test("a connect's late address lands in the tab its press opened, and this tab stays put", async () => {
  const { browser, tabs, navigated } = fakeBrowser({ refusesTabs: false });
  const connect = connectTabs(browser);
  const bridge = connect.bridge(hostBridge(connect.open, true));

  await bridge.act(CONNECT);

  expect(tabs.map((tab) => tab.sentTo())).toEqual([PROVIDER_ADDRESS]);
  expect(tabs.map((tab) => tab.closed())).toEqual([false]);
  expect(navigated).toEqual([]);
});

test("a refused tab sends this tab on, leaving its address for the landing page's way back", async () => {
  const { browser, navigated } = fakeBrowser({ refusesTabs: true });
  const connect = connectTabs(browser);
  const bridge = connect.bridge(hostBridge(connect.open, true));

  await bridge.act(CONNECT);

  expect(navigated).toEqual([PROVIDER_ADDRESS]);
  expect(connectReturn()).toEqual({
    kind: CONNECT_RETURN.ADDRESS,
    href: "/plan/4f0b6a0e?tab=agents#settings",
  });
});

test("a press whose act opened nothing closes its empty tab", async () => {
  const { browser, tabs } = fakeBrowser({ refusesTabs: false });
  const connect = connectTabs(browser);
  const bridge = connect.bridge(hostBridge(connect.open, false));

  await bridge.act(CONNECT);

  expect(tabs.map((tab) => tab.closed())).toEqual([true]);
});

test("an act that is no connect opens no tab, and its address opens as a link", async () => {
  const { browser, tabs, navigated, links } = fakeBrowser({ refusesTabs: false });
  const connect = connectTabs(browser);
  const bridge = connect.bridge(hostBridge(connect.open, true));

  await bridge.act({ kind: ACT_KIND.WEB_OPEN, payload: { url: PROVIDER_ADDRESS } });

  expect(tabs).toEqual([]);
  expect(navigated).toEqual([]);
  expect(links).toEqual([PROVIDER_ADDRESS]);
});

test("connects answered out of order each open in a tab, and the one that opened nothing leaves none", async () => {
  const { browser, tabs } = fakeBrowser({ refusesTabs: false });
  const connect = connectTabs(browser);
  // The first press's act is still out when the second's answers with its address; then the first opens nothing.
  let refuseFirst: (outcome: ActOutcome) => void = () => undefined;
  // SAFETY: the connect wraps the bridge's `act` alone and hands every other door through untouched.
  const first: AppBridge = {
    act: (_act: Act) =>
      new Promise<ActOutcome>((resolve) => {
        refuseFirst = resolve;
      }),
  } as AppBridge;
  const firstPress = connect.bridge(first).act(CONNECT);
  await connect.bridge(hostBridge(connect.open, true)).act(CONNECT);
  refuseFirst({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "GitHub could not be reached." });
  await firstPress;

  const open = tabs.filter((tab) => !tab.closed());
  expect(open.map((tab) => tab.sentTo())).toEqual([PROVIDER_ADDRESS]);
});
