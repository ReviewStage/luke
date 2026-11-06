import { ACT_KIND } from "@repo/host/acts";
import type { ActPortClient } from "@repo/host/contract";
import { type ConnectBrowser, type ConnectTab, connectTabs } from "../../src/app/connect-tab";

export interface AppTab {
  readonly landIn: (connect: number) => void;
}

const listening = new Set<() => void>();

export function closeAppTabs(): void {
  for (const close of listening) close();
  listening.clear();
}

function emptyTab(storage: Map<string, string>): ConnectTab {
  return {
    closed: false,
    close: () => undefined,
    location: { replace: () => undefined },
    sessionStorage: { setItem: (key, value) => void storage.set(key, value) },
  };
}

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
  const host: Partial<ActPortClient> = {
    [ACT_KIND.GITHUB_CONNECT]: async () => {
      tabs.open("https://provider.example/oauth/authorize");
    },
  };
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
