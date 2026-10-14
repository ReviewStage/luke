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
  /** Opens the connect page in the browser; answers whether it opened, a refusal saying why on its own. */
  readonly connect: () => Promise<boolean>;
}

const GitHubConnectContext = createContext<GitHubConnectControl>({
  connection: undefined,
  connect: () => Promise.resolve(false),
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

/**
 * One connect begun from a surface: away in the browser, or back with the
 * connection the window held at the moment it came back, which a read since
 * then replaces.
 */
type Attempt =
  | { readonly back: false }
  | { readonly back: true; readonly heldOnReturn: GitHubConnection | undefined };

/**
 * A connect begun in place, waiting while the browser has it. Note that a
 * landing is read only from a connection read after the window came back,
 * never from the one it held on its return, because a GitHub already linked
 * whose authorization lapsed reads connected before the browser trip as
 * after it; coming back without finishing keeps the wait, and the next
 * return reads again. A page that could not be opened ends the wait at once.
 * Cancel, or the surface going away, ends it and lands nothing.
 */
export function useGitHubConnect(onConnected: () => void): GitHubConnectPress {
  const { connection, connect } = useGitHubConnection();
  const [attempt, setAttempt] = useState<Attempt | undefined>(undefined);
  const landed = useRef(onConnected);
  landed.current = onConnected;
  const held = useRef(connection);
  held.current = connection;
  // Note that each press is one attempt, so a page that failed to open for
  // an attempt since withdrawn cannot end a later one's wait.
  const pressed = useRef(0);
  useEffect(() => () => void ++pressed.current, []);

  useEffect(() => {
    if (attempt === undefined) return;
    const back = () => setAttempt({ back: true, heldOnReturn: held.current });
    window.addEventListener("focus", back);
    return () => window.removeEventListener("focus", back);
  }, [attempt]);

  useEffect(() => {
    if (attempt?.back !== true || connection === attempt.heldOnReturn) return;
    if (connection?.connected !== true) return;
    pressed.current += 1;
    setAttempt(undefined);
    landed.current();
  }, [attempt, connection]);

  return {
    waiting: attempt !== undefined,
    begin: () => {
      const mine = ++pressed.current;
      setAttempt({ back: false });
      void connect().then((opened) => {
        if (!opened && pressed.current === mine) setAttempt(undefined);
      });
    },
    cancel: () => {
      pressed.current += 1;
      setAttempt(undefined);
    },
  };
}
