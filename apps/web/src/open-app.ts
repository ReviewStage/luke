import { APP_HOME_LINK } from "@repo/features/link-home";
import { LINK_PLATFORM, type LinkPlatform } from "@repo/features/link-open";
import { PRODUCT_NAME } from "@repo/features/product-name";
import type { AuthAction } from "@repo/ui";
import { browserLinkPlatform } from "./link-platform";

export const OPEN_APP = `Open ${PRODUCT_NAME}`;

export function openMacApp(platform: LinkPlatform): AuthAction | undefined {
  return platform === LINK_PLATFORM.MAC ? { label: OPEN_APP, href: APP_HOME_LINK } : undefined;
}

export function openAppFromMac(): AuthAction | undefined {
  return openMacApp(browserLinkPlatform());
}
