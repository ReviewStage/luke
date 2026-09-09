import { ACCOUNTS_SORT_KEY, type AccountsSort, SORT_DIRECTION } from "./accounts-table/sort";

export interface RememberedFlag {
  read(): boolean;
  write(value: boolean): void;
}

/**
 * A boolean kept as the presence of a localStorage key. `absentMeans` is what
 * a browser with no key — or one that refuses storage altogether — reads as;
 * the key is written to mean the opposite and removed to mean `absentMeans`
 * again, so the remembered state is always the exception to the default.
 */
export function rememberedFlag(key: string, absentMeans = false): RememberedFlag {
  return {
    read(): boolean {
      try {
        return (window.localStorage.getItem(key) === null) === absentMeans;
      } catch {
        return absentMeans;
      }
    },
    write(value: boolean): void {
      try {
        if (value === absentMeans) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, String(value));
      } catch {
        // Storage refused: the flag opens at its default on the next visit.
      }
    },
  };
}

/**
 * The site's session cookie is shared with the sign-in flow the desktop app
 * opens in this browser, so the first visit to the admin page would otherwise
 * land already signed in — on a session the maintainer never chose to spend
 * there. The dashboard opens only after a sign-in pressed on that page once;
 * the press is remembered locally, and from then on an existing session
 * resumes the way it does on any signed-in page. Signing out takes the press
 * back with the session, or the next cookie earned elsewhere on the site would
 * open the dashboard on a consent the maintainer gave once and then withdrew.
 */
export const SIGN_IN_CHOSEN = rememberedFlag("luke-admin-sign-in-chosen");

/**
 * Whether the sidebar was left collapsed, remembered the way the sign-in press
 * is, so a browser that refuses storage simply opens expanded every visit.
 */
export const SIDEBAR_COLLAPSED = rememberedFlag("luke-admin-sidebar-collapsed");

/**
 * Whether the "Hide admins" filter is on. The key marks the exception, so a
 * browser that refuses storage simply opens with admins hidden.
 */
export const ADMINS_HIDDEN = rememberedFlag("luke-admin-hide-admins", true);

export interface RememberedValue<T> {
  read(): T | undefined;
  write(value: T): void;
}

/**
 * A value kept as a localStorage string. A stored string `decode` does not
 * recognise reads as nothing at all, never as a guess at what an old build
 * meant by it.
 */
export function rememberedValue<T>(
  key: string,
  encode: (value: T) => string,
  decode: (stored: string) => T | undefined,
): RememberedValue<T> {
  return {
    read(): T | undefined {
      try {
        const stored = window.localStorage.getItem(key);
        return stored === null ? undefined : decode(stored);
      } catch {
        return undefined;
      }
    },
    write(value: T): void {
      try {
        window.localStorage.setItem(key, encode(value));
      } catch {
        // Storage refused: the value opens at its default on the next visit.
      }
    },
  };
}

/** No sort key contains the separator, so the stored token splits back apart. */
const ACCOUNTS_SORT_SEPARATOR = ":";

/**
 * The last roster sort chosen, so a refresh reopens it in the order it was
 * left. A stored value the sets no longer name reads as no sort at all — the
 * server's own order — rather than a guess at what an old build meant by it.
 */
export const ACCOUNTS_SORT: RememberedValue<AccountsSort> = rememberedValue(
  "luke-admin-users-sort",
  (sort) => `${sort.key}${ACCOUNTS_SORT_SEPARATOR}${sort.direction}`,
  (stored) => {
    const [key, direction] = stored.split(ACCOUNTS_SORT_SEPARATOR);
    const knownKey = Object.values(ACCOUNTS_SORT_KEY).find((candidate) => candidate === key);
    const knownDirection = Object.values(SORT_DIRECTION).find(
      (candidate) => candidate === direction,
    );
    return knownKey === undefined || knownDirection === undefined
      ? undefined
      : { key: knownKey, direction: knownDirection };
  },
);
