/**
 * connect-app-tab.ts -- the web app's tab as a landing page's test meets it: the real connect tabs, one connect handed off to a tab of its own or none, listening on the channel a landing speaks on.
 */

import { ACT_KIND } from "@luke/host/acts";
import type { ActPortClient } from "@luke/host/contract";
import { type ConnectBrowser, type ConnectTab, connectTabs } from "../../src/app/connect-tab";

/** An empty tab the browser opened, which takes any address. */
function emptyTab(): ConnectTab {
  return { closed: false, close: () => undefined, location: { replace: () => undefined } };
}

const BROWSER: ConnectBrowser = {
  openEmptyTab: emptyTab,
  navigate: () => undefined,
  address: () => "/app",
  openLink: () => undefined,
};

/** The app's tab, having handed `connects` connects off to tabs of their own; its close stops it listening. */
export async function appTab(connects: number): Promise<{ readonly close: () => void }> {
  const tabs = connectTabs(BROWSER);
  // SAFETY: the connect wraps the procedures it names and hands every other one through untouched, so only the account's GitHub connect is answered.
  const host = {
    [ACT_KIND.GITHUB_CONNECT]: async () => {
      tabs.open("https://provider.example/oauth/authorize");
    },
  } as unknown as ActPortClient;
  const port = tabs.portClient(host);
  for (let connect = 0; connect < connects; connect += 1) {
    await port[ACT_KIND.GITHUB_CONNECT]();
  }
  return { close: tabs.listen() };
}
