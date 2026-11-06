// @vitest-environment jsdom
import { ACT_KIND } from "@repo/host/acts";
import type { ActPortClient } from "@repo/host/contract";
import { afterEach, expect, test } from "vitest";
import { type ConnectBrowser, type ConnectTab, connectTabs } from "../src/app/connect-tab";
import { pageLeave } from "../src/app/page-leave";
import { CONNECT_RETURN, connectReturn } from "../src/connect-return";

const PROVIDER_ADDRESS = "https://provider.example/oauth/authorize";

const OFF_THE_WEB = [
  "javascript:alert(document.cookie)",
  "data:text/html,<script>alert(document.cookie)</script>",
] as const;

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
    sessionStorage: { setItem: () => undefined },
  };
  return { window, sentTo: () => sentTo, closed: () => closed };
}

function fakeBrowser(options: {
  readonly refusesTabs: boolean;
  readonly leave?: (go: () => void) => void;
}) {
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
    leave: options.leave ?? ((go) => go()),
    address: () => "/plan/4f0b6a0e?tab=agents#settings",
    openLink: (url) => links.push(url),
  };
  return { browser, tabs, navigated, links };
}

function hostPort(
  open: (url: string) => void,
  opens: boolean,
  address: string = PROVIDER_ADDRESS,
): ActPortClient {
  const host: Partial<ActPortClient> = {
    [ACT_KIND.GITHUB_CONNECT]: async () => {
      await Promise.resolve();
      if (opens) open(address);
    },
    [ACT_KIND.WEB_OPEN]: async ({ url }) => {
      await Promise.resolve();
      open(url);
    },
  };
  return host as ActPortClient;
}

afterEach(() => {
  sessionStorage.clear();
});

test("a connect's late address lands in the tab its press opened, and this tab stays put", async () => {
  const { browser, tabs, navigated } = fakeBrowser({ refusesTabs: false });
  const connect = connectTabs(browser);
  const port = connect.portClient(hostPort(connect.open, true));

  await port[ACT_KIND.GITHUB_CONNECT]();

  expect(tabs.map((tab) => tab.sentTo())).toEqual([PROVIDER_ADDRESS]);
  expect(tabs.map((tab) => tab.closed())).toEqual([false]);
  expect(navigated).toEqual([]);
});

test("a refused tab sends this tab on, leaving its address for the landing page's way back", async () => {
  const { browser, navigated } = fakeBrowser({ refusesTabs: true });
  const connect = connectTabs(browser);
  const port = connect.portClient(hostPort(connect.open, true));

  await port[ACT_KIND.GITHUB_CONNECT]();

  expect(navigated).toEqual([PROVIDER_ADDRESS]);
  expect(connectReturn()).toEqual({
    kind: CONNECT_RETURN.ADDRESS,
    href: "/plan/4f0b6a0e?tab=agents#settings",
  });
});

test("a refused tab asks first while the page holds unsaved work, and sends this tab on only once told to leave", async () => {
  const tab = pageLeave(new EventTarget());
  const asked: (() => void)[] = [];
  tab.unsavedWork((leave) => asked.push(leave));
  const { browser, navigated } = fakeBrowser({ refusesTabs: true, leave: tab.leave });
  const connect = connectTabs(browser);
  const port = connect.portClient(hostPort(connect.open, true));

  await port[ACT_KIND.GITHUB_CONNECT]();
  expect(asked).toHaveLength(1);
  expect(navigated).toEqual([]);
  expect(connectReturn()).toEqual({ kind: CONNECT_RETURN.ELSEWHERE });

  asked[0]?.();
  expect(navigated).toEqual([PROVIDER_ADDRESS]);
  expect(connectReturn()).toEqual({
    kind: CONNECT_RETURN.ADDRESS,
    href: "/plan/4f0b6a0e?tab=agents#settings",
  });
});

test("a press whose act opened nothing closes its empty tab", async () => {
  const { browser, tabs } = fakeBrowser({ refusesTabs: false });
  const connect = connectTabs(browser);
  const port = connect.portClient(hostPort(connect.open, false));

  await port[ACT_KIND.GITHUB_CONNECT]();

  expect(tabs.map((tab) => tab.closed())).toEqual([true]);
});

test("an act that is no connect opens no tab, and its address opens as a link", async () => {
  const { browser, tabs, navigated, links } = fakeBrowser({ refusesTabs: false });
  const connect = connectTabs(browser);
  const port = connect.portClient(hostPort(connect.open, true));

  await port[ACT_KIND.WEB_OPEN]({ url: PROVIDER_ADDRESS });

  expect(tabs).toEqual([]);
  expect(navigated).toEqual([]);
  expect(links).toEqual([PROVIDER_ADDRESS]);
});

test("connects answered out of order each open in a tab, and the one that opened nothing leaves none", async () => {
  const { browser, tabs } = fakeBrowser({ refusesTabs: false });
  const connect = connectTabs(browser);
  let refuseFirst: (error: Error) => void = () => undefined;
  const first: Partial<ActPortClient> = {
    [ACT_KIND.GITHUB_CONNECT]: () =>
      new Promise<void>((_resolve, reject) => {
        refuseFirst = reject;
      }),
  };
  const firstPort = connect.portClient(first as ActPortClient);
  const firstPress = firstPort[ACT_KIND.GITHUB_CONNECT]().catch(() => undefined);
  await connect.portClient(hostPort(connect.open, true))[ACT_KIND.GITHUB_CONNECT]();
  refuseFirst(new Error("GitHub could not be reached."));
  await firstPress;

  const open = tabs.filter((tab) => !tab.closed());
  expect(open.map((tab) => tab.sentTo())).toEqual([PROVIDER_ADDRESS]);
});

test("a connect's address off the web lands in no tab, and its press's tab closes as its act ends", async () => {
  for (const address of OFF_THE_WEB) {
    const { browser, tabs, navigated } = fakeBrowser({ refusesTabs: false });
    const connect = connectTabs(browser);

    await connect.portClient(hostPort(connect.open, true, address))[ACT_KIND.GITHUB_CONNECT]();

    expect(tabs.map((tab) => [tab.sentTo(), tab.closed()])).toEqual([[undefined, true]]);
    expect(navigated).toEqual([]);
  }
});

test("where the browser refused the press's tab, an address off the web never sends this tab on, and leaves no way back", async () => {
  for (const address of OFF_THE_WEB) {
    const { browser, navigated } = fakeBrowser({ refusesTabs: true });
    const connect = connectTabs(browser);

    await connect.portClient(hostPort(connect.open, true, address))[ACT_KIND.GITHUB_CONNECT]();

    expect(navigated).toEqual([]);
    expect(connectReturn()).toEqual({ kind: CONNECT_RETURN.ELSEWHERE });
  }
});

test("an address off the web the host opens as a link opens nothing", async () => {
  const { browser, links } = fakeBrowser({ refusesTabs: false });
  const connect = connectTabs(browser);
  const port = connect.portClient(hostPort(connect.open, true));

  for (const address of OFF_THE_WEB) await port[ACT_KIND.WEB_OPEN]({ url: address });

  expect(links).toEqual([]);
});

test("a page the browser brings back from its cache lets go of the way back a same-tab connect left from it", async () => {
  const { browser, navigated } = fakeBrowser({ refusesTabs: true });
  const connect = connectTabs(browser);
  const stop = connect.listen();
  await connect.portClient(hostPort(connect.open, true))[ACT_KIND.GITHUB_CONNECT]();
  expect(navigated).toEqual([PROVIDER_ADDRESS]);

  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));

  expect(connectReturn()).toEqual({ kind: CONNECT_RETURN.ELSEWHERE });
  stop();
});
