import { NEEDS_YOU } from "../tasks/inbox-model.js";

/**
 * places-waiting.ts -- how a count of what waits on the developer is said
 * by the places that count it: each channel's row in the sidebar
 * (`sidebar-channels.tsx`), a phone's list of channels (`channel-list.tsx`),
 * and its places bar (`mobile-bar.tsx`), so the drawer and the bar never
 * disagree.
 */

/** What a count of what waits on the developer is said with, after its figure: "3 need you". */
export function needsYouNoun(count: number): string {
  return count === 1 ? NEEDS_YOU.COUNT.one : NEEDS_YOU.COUNT.many;
}
