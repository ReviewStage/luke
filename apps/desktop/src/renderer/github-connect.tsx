import type { GitHubConnection } from "@sidecar/hosted/github-connection-wire";
import { createContext, useContext, useEffect, useRef, useState } from "react";

/**
 * github-connect.tsx -- connecting the account's own GitHub from where a refusal stands, and knowing when it landed.
 *
 * GitHub is connected apart from signing in, through a page of the
 * service's in the browser (Settings › Connected accounts opens the same
 * one), so an account made with Google links GitHub too. A surface that a
 * missing GitHub refused offers that connect in place rather than sending
 * the developer to Settings: the press opens the browser, the surface waits,
 * and once the window is back with GitHub connected, the surface tries
 * again by itself. The window's connection and its connect are handed down
 * on a context, as `open-settings.tsx`'s opener is; outside the window, as
 * in a test of one surface, nothing is connected and the connect does nothing.
 */

/** The account's GitHub as the window last read it, and the press that connects it in the browser. */
export interface GitHubConnectControl {
  readonly connection: GitHubConnection | undefined;
  readonly connect: () => void;
}

const GitHubConnectContext = createContext<GitHubConnectControl>({
  connection: undefined,
  connect: () => undefined,
});

/** Hands the window's GitHub connection and its connect to everything under it. */
export const GitHubConnectProvider = GitHubConnectContext.Provider;

/** The window's GitHub connection and its connect. */
export function useGitHubConnection(): GitHubConnectControl {
  return useContext(GitHubConnectContext);
}

/** A connect begun in place, as the surface that offers it draws and presses it. */
export interface GitHubConnectPress {
  /** Whether the browser has the connect, so the press waits. */
  readonly waiting: boolean;
  readonly begin: () => void;
  /** Withdraws the wait, so a connect that lands after it lands nothing. */
  readonly cancel: () => void;
}

/** One connect begun from a surface: whether the window has come back from the browser since. */
interface Attempt {
  readonly returned: boolean;
}

/**
 * A connect begun in place, waiting while the browser has it. Note that the
 * landing is read only once the window has come back, because a GitHub
 * already connected whose authorization lapsed reads connected before the
 * browser trip as after it; the window's return is what re-reads it.
 * Cancel, or the surface going away, ends the wait and lands nothing.
 */
export function useGitHubConnect(onConnected: () => void): GitHubConnectPress {
  const { connection, connect } = useGitHubConnection();
  const [attempt, setAttempt] = useState<Attempt | undefined>(undefined);
  const landed = useRef(onConnected);
  landed.current = onConnected;

  useEffect(() => {
    if (attempt === undefined || attempt.returned) return;
    const back = () => setAttempt({ returned: true });
    window.addEventListener("focus", back);
    return () => window.removeEventListener("focus", back);
  }, [attempt]);

  useEffect(() => {
    if (attempt?.returned !== true || connection?.connected !== true) return;
    setAttempt(undefined);
    landed.current();
  }, [attempt, connection]);

  return {
    waiting: attempt !== undefined,
    begin: () => {
      setAttempt({ returned: false });
      connect();
    },
    cancel: () => setAttempt(undefined),
  };
}
