import { isAppLinkProtocol, LINK_HOME } from "@luke/features/link-home";
import { type ReadLink, readLink } from "@luke/features/luke-link";

/**
 * app-links.ts -- a Luke link the system hands the app: the place it names, and the links that arrive before a window can open them.
 *
 * A link to anything in Luke is the same address on the web and in the app
 * (`@luke/features/luke-link`); the browser's "Open in Luke" page hands it
 * to the app in the app's own scheme (`@luke/features/link-home`), which
 * the bundle registers with macOS (`scripts/electron-builder-config.mjs`'s
 * `protocols`). macOS delivers it as `open-url`, the link that launched the
 * app among them, which arrives before any window stands; a second launch
 * elsewhere carries it among its arguments. Either way it is read by the
 * one module that knows a link's form, only as a place in Luke, and anything
 * else is refused. A link only opens a place: nothing it carries starts a
 * call, writes, or reaches the host, and whoever opens it is checked there,
 * as the place's own read checks them.
 *
 * Links are held until a panel says it has painted and is listening, so the
 * link that launched the app opens once the window can open it; after that
 * each opens as it comes.
 */

/** The app's own scheme, as the bundle registers it with macOS. */
export const APP_LINK_SCHEME = LINK_HOME.APP_SCHEME;

/** The most links held while no window can open them; a launch hands one. */
const MAX_HELD = 8;

/** What opens a link's place in the panels. */
type AppLinkOpener = (link: ReadLink) => void;

/** The links the system hands the app, held until a window can open them. */
export interface AppLinkInbox {
  /** A link the system handed the app, opened now where a window can, held where none can yet. */
  readonly arrive: (url: string) => void;
  /** A panel can open links now: every link held opens through `open`, in the order it came, and every later one as it comes. */
  readonly ready: (open: AppLinkOpener) => void;
  /** No window opens a link any longer, as the launch is torn down, and none is held for one. */
  readonly close: () => void;
}

/** Whether an argument is a link in the app's own scheme, or one it was once handed links in. */
function isAppLink(argument: string): boolean {
  const colon = argument.indexOf(":");
  return colon > 0 && isAppLinkProtocol(argument.slice(0, colon + 1));
}

/** The place a link in the app's own scheme names, and the workspace it was written under; nothing for any other address. */
export function placeOfAppLink(url: string): ReadLink | undefined {
  return isAppLink(url) ? readLink(url) : undefined;
}

/** The link a launch's arguments carry, as a second launch hands one: the last argument in the app's own scheme. */
export function appLinkInArguments(argv: readonly string[]): string | undefined {
  return argv.findLast(isAppLink);
}

/** What a launch hands Electron after the scheme when it claims it: the binary a link starts, and the arguments it starts it with. */
export type AppLinkClaim = [executable: string, args: string[]];

/**
 * Whether this launch asks macOS to send it the app's own scheme, and on
 * what. A packaged build claims it as itself, its bundle declaring the
 * scheme. A live development run asks too, on the Electron binary it runs
 * and the app it was started on, so a link may reach the build
 * `./scripts/run.sh` launched rather than an older Luke installed beside it.
 * Note that the stock Electron bundle a development run is declares no
 * scheme, so whether macOS honours that claim is LaunchServices' to decide;
 * `pnpm package:dir`'s Luke.app declares it, and is the local build a link
 * surely reaches. A fixture or capture run claims nothing, so a
 * deterministic run never takes the developer's links.
 */
export function appLinkClaim(launch: {
  readonly packaged: boolean;
  readonly live: boolean;
  readonly executable: string;
  readonly appPath: string;
}): AppLinkClaim | undefined {
  if (launch.packaged) return [launch.executable, []];
  if (!launch.live) return undefined;
  return [launch.executable, [launch.appPath]];
}

/** An inbox holding no link and able to open none yet. */
export function appLinkInbox(): AppLinkInbox {
  const held: ReadLink[] = [];
  let opener: AppLinkOpener | undefined;
  let closed = false;
  return {
    arrive: (url) => {
      const link = placeOfAppLink(url);
      if (link === undefined || closed) return;
      if (opener !== undefined) opener(link);
      else if (held.length < MAX_HELD) held.push(link);
    },
    ready: (open) => {
      if (closed) return;
      opener = open;
      for (const link of held.splice(0)) open(link);
    },
    close: () => {
      closed = true;
      opener = undefined;
      held.length = 0;
    },
  };
}
