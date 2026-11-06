import { LINK_PLATFORM, type LinkPlatform } from "@repo/features/link-open";

export function browserLinkPlatform(): LinkPlatform {
  const mac = /\bMacintosh\b/u.test(navigator.userAgent) && navigator.maxTouchPoints <= 1;
  return mac ? LINK_PLATFORM.MAC : LINK_PLATFORM.OTHER;
}
