import { decodeMention, MENTION_KIND } from "@luke/features/mention-link";

/**
 * app-links.ts -- a Luke link the system hands the app: the plan and section it names, and the links that arrive before a window can open them.
 *
 * A plan's link is the same address on the web and in the app
 * (`https://tryluke.dev/<workspace>/plan/<id>#<section>`); the browser's
 * "Open in Luke" page hands it to the app in the app's own scheme,
 * `tryluke://`, which the bundle registers with macOS
 * (`scripts/electron-builder-config.mjs`'s `protocols`). macOS delivers it
 * as `open-url`, the link that launched the app among them, which arrives
 * before any window stands; a second launch elsewhere carries it among its
 * arguments. Either way it is read by the one module that knows a link's
 * form (`@luke/features/mention-link`), only as a plan or a section of one,
 * and anything else is refused. A link only opens a plan: nothing it
 * carries starts a call, writes, or reaches the host.
 *
 * Links are held until a panel says it has painted and is listening, so the
 * link that launched the app opens once the window can open it; after that
 * each opens as it comes.
 */

/** The app's own scheme, as the bundle registers it with macOS. */
export const APP_LINK_SCHEME = "tryluke";

/** The most links held while no window can open them; a launch hands one. */
const MAX_HELD = 8;

/** The plan a link names, and the anchor of its section where it names one. */
export interface AppLinkPlace {
  readonly planId: string;
  readonly anchor?: string;
}

/** What opens a link's plan in the panels. */
type AppLinkOpener = (place: AppLinkPlace) => void;

/** The links the system hands the app, held until a window can open them. */
export interface AppLinkInbox {
  /** A link the system handed the app, opened now where a window can, held where none can yet. */
  readonly arrive: (url: string) => void;
  /** A panel can open links now: every link held opens through `open`, in the order it came, and every later one as it comes. */
  readonly ready: (open: AppLinkOpener) => void;
  /** No window opens a link any longer, as the launch is torn down, and none is held for one. */
  readonly close: () => void;
}

/** The plan and section a link in the app's own scheme names; nothing for any other address. */
export function placeOfAppLink(url: string): AppLinkPlace | undefined {
  if (!url.startsWith(`${APP_LINK_SCHEME}:`)) return undefined;
  const mention = decodeMention(url, null);
  if (mention?.kind === MENTION_KIND.PLAN) return { planId: mention.planId };
  if (mention?.kind === MENTION_KIND.SECTION) {
    return { planId: mention.planId, anchor: mention.anchor };
  }
  return undefined;
}

/** The link a launch's arguments carry, as a second launch hands one: the last argument in the app's own scheme. */
export function appLinkInArguments(argv: readonly string[]): string | undefined {
  return argv.findLast((argument) => argument.startsWith(`${APP_LINK_SCHEME}:`));
}

/** An inbox holding no link and able to open none yet. */
export function appLinkInbox(): AppLinkInbox {
  const held: AppLinkPlace[] = [];
  let opener: AppLinkOpener | undefined;
  let closed = false;
  return {
    arrive: (url) => {
      const place = placeOfAppLink(url);
      if (place === undefined || closed) return;
      if (opener !== undefined) opener(place);
      else if (held.length < MAX_HELD) held.push(place);
    },
    ready: (open) => {
      if (closed) return;
      opener = open;
      for (const place of held.splice(0)) open(place);
    },
    close: () => {
      closed = true;
      opener = undefined;
      held.length = 0;
    },
  };
}
