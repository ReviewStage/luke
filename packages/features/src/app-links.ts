import { readShownLink, type ShownLink } from "@repo/features/link-grammar";
import { isAppLinkProtocol, LINK_HOME } from "@repo/features/link-home";

export const APP_LINK_SCHEME = LINK_HOME.APP_SCHEME;

const MAX_HELD = 8;

type AppLinkOpener = (link: ShownLink) => void;

export interface AppLinkInbox {
  readonly arrive: (url: string) => void;
  readonly ready: (open: AppLinkOpener) => void;
  readonly close: () => void;
}

function isAppLink(argument: string): boolean {
  const colon = argument.indexOf(":");
  return colon > 0 && isAppLinkProtocol(argument.slice(0, colon + 1));
}

export function placeOfAppLink(url: string): ShownLink | undefined {
  return isAppLink(url) ? readShownLink(url) : undefined;
}

export function appLinkInArguments(argv: readonly string[]): string | undefined {
  return argv.findLast(isAppLink);
}

export const APP_LINK_CLAIM = {
  CLAIM: "claim",
  RELEASE: "release",
  LEAVE: "leave",
} as const;

export type AppLinkClaim = (typeof APP_LINK_CLAIM)[keyof typeof APP_LINK_CLAIM];

export function appLinkClaim(launch: {
  readonly packaged: boolean;
  readonly live: boolean;
}): AppLinkClaim {
  if (launch.packaged) return APP_LINK_CLAIM.CLAIM;
  if (launch.live) return APP_LINK_CLAIM.RELEASE;
  return APP_LINK_CLAIM.LEAVE;
}

export function appLinkInbox(): AppLinkInbox {
  const held: ShownLink[] = [];
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
