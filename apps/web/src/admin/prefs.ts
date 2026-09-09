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
