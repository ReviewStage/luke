/**
 * connect-app-tab.ts -- the web app's tab as a landing page's test meets it: the real connect tabs, connects handed off to tabs of their own or none, listening on the channel a landing speaks on, and a landing come back in one of those tabs.
 */

import { ACT_KIND } from "@luke/host/acts";
import type { ActPortClient } from "@luke/host/contract";
import { type ConnectBrowser, type ConnectTab, connectTabs } from "../../src/app/connect-tab";

/** The app's tab, as a landing page's test reaches it. */
export interface AppTab {
  /**
   * Makes the page about to load the landing of the `connect`th connect
   * handed off, come back in that connect's own tab: this window's session
   * storage takes what the app wrote into that tab while it was empty.
   */
  readonly landIn: (connect: number) => void;
}

/** Each app tab still listening, so a test that fails part-way leaves none answering the next test's landings. */
const listening = new Set<() => void>();

/** Stops every app tab listening; a landing test's `afterEach` calls it. */
export function closeAppTabs(): void {
  for (const close of listening) close();
  listening.clear();
}

/** An empty tab the browser opened, which takes any address and keeps what is written to its session storage. */
function emptyTab(storage: Map<string, string>): ConnectTab {
  return {
    closed: false,
    close: () => undefined,
    location: { replace: () => undefined },
    sessionStorage: { setItem: (key, value) => void storage.set(key, value) },
  };
}

/** The app's tab, having handed `connects` connects off to tabs of their own. */
export async function appTab(connects: number): Promise<AppTab> {
  const storages: Map<string, string>[] = [];
  const browser: ConnectBrowser = {
    openEmptyTab: () => {
      const storage = new Map<string, string>();
      storages.push(storage);
      return emptyTab(storage);
    },
    navigate: () => undefined,
    leave: (go) => go(),
    address: () => "/app",
    openLink: () => undefined,
  };
  const tabs = connectTabs(browser);
  // Only the account's GitHub connect is answered here.
  const host: Partial<ActPortClient> = {
    [ACT_KIND.GITHUB_CONNECT]: async () => {
      tabs.open("https://provider.example/oauth/authorize");
    },
  };
  // SAFETY: the connect wraps the procedures it names and hands every other one through untouched, so only the one called need be answered.
  const port = tabs.portClient(host as ActPortClient);
  for (let connect = 0; connect < connects; connect += 1) {
    await port[ACT_KIND.GITHUB_CONNECT]();
  }
  listening.add(tabs.listen());
  return {
    landIn: (connect) => {
      const storage = storages[connect];
      if (storage === undefined) throw new Error(`No connect ${connect} was handed off.`);
      for (const [key, value] of storage) sessionStorage.setItem(key, value);
    },
  };
}
