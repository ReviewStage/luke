import { app } from "electron";

/** The narrow macOS login-item surface this feature is allowed to use. */
export interface LoginItemSurface {
  getLoginItemSettings(): { openAtLogin: boolean };
  setLoginItemSettings(settings: { openAtLogin: boolean }): void;
}

export interface LoginItemOptions {
  surface?: LoginItemSurface;
  packaged?: boolean;
  platform?: NodeJS.Platform;
  /** False for fixture and evidence runs, which may not touch this Mac. */
  enabled?: boolean;
}

/**
 * Luke's registration in macOS Login Items. An unpackaged, non-Mac, fixture,
 * or evidence run has no observable state and accepts no writes, so a test
 * launch can never register itself.
 */
export class LoginItem {
  readonly #surface: LoginItemSurface;
  readonly #supported: boolean;

  constructor(options: LoginItemOptions = {}) {
    this.#surface = options.surface ?? app;
    this.#supported =
      (options.enabled ?? true) &&
      (options.packaged ?? app.isPackaged) &&
      (options.platform ?? process.platform) === "darwin";
  }

  observed(): boolean | undefined {
    if (!this.#supported) return undefined;
    return this.#surface.getLoginItemSettings().openAtLogin;
  }

  apply(openAtLogin: boolean): void {
    if (!this.#supported) return;
    this.#surface.setLoginItemSettings({ openAtLogin });
  }
}

/**
 * Converges the optional stored preference with macOS at launch. The first
 * supported launch spends the default once; every later launch mirrors the
 * system's answer so removing Luke in System Settings stands.
 */
export async function reconcileLoginItem(
  loginItem: LoginItem,
  stored: boolean | undefined,
  defaultOpen: boolean,
  persist: (openAtLogin: boolean) => Promise<void>,
): Promise<void> {
  const observed = loginItem.observed();
  if (observed === undefined) return;
  if (stored === undefined) {
    loginItem.apply(defaultOpen);
    await persist(defaultOpen);
  } else if (observed !== stored) {
    await persist(observed);
  }
}
