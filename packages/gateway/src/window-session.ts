/**
 * How screen recording is armed, decided in the main process and carried on
 * every version of the app-state document.
 *
 * It carries what the renderer cannot work out for itself and nothing else.
 * There is no switch among it, because recording has none: whether a run
 * records is the main process's answer alone, `permitted` below, and since
 * every version of the document carries it, an answer that turns false — an
 * account deleted mid-run — stops a recording where it stands, and one that
 * turns true again at the next sign-in resumes it, rather than either waiting
 * for the next launch.
 * Where a recording goes is not here either: the processor's address is fixed
 * by the build, in the renderer beside the connect policy that names it.
 */
export interface SessionReplayBootstrap {
  /**
   * Whether this run may record at all. False for a fixture and a capture
   * run, which must stay deterministic and send nothing, and false after an
   * account is deleted until the next sign-in.
   * Being signed out is not one of the reasons: recording begins at the first
   * paint, before an account exists.
   */
  permitted: boolean;
  /**
   * This build's own version, for the recorder to file what it sends under.
   * It rides here rather than on a channel of its own because the renderer
   * has no way to read it: the bundle is written once and the version is a
   * fact of the packaged app around it.
   */
  appVersion: string;
  /**
   * Whether this build runs from a packaged bundle rather than a development
   * checkout, registered beside the version so a recording can be told apart
   * the way the counted events are.
   */
  packaged: boolean;
  /**
   * The account's opaque id, absent while signed out. It is the same id the
   * hosted endpoints resolve a bearer token to, so a recording lands on the
   * person the counted events already belong to — which is also what makes
   * deleting the account erase the recordings with it. A recording that runs
   * while this is absent is anonymous, joined to the person if a sign-in
   * lands during it and to nobody if none ever does.
   */
  accountId?: string | undefined;
}
