/**
 * github-people.ts -- the people a pull request names on GitHub, as the 0.17.0 shots draw them: acme's members by their own pictures, and Vercel's bot by its mark.
 *
 * Throwaway (`README.md`). A person with a `userId` is drawn by the
 * workspace's member picture (`who.ts`); the bot by a data URL, so no
 * capture reaches the network.
 */

import type { GitHubPerson } from "@luke/features/agent-wire";
import { DEAN_AVATAR_DATA_URL } from "./dean-avatar";
import { initialPicture, MEMBER } from "./who";

/** Vercel's mark, white on black, full bleed. */
const VERCEL_MARK = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#000"/><path d="M32 18 L48 46 H16 Z" fill="#fff"/></svg>',
)}`;

export const GITHUB = {
  DEAN: {
    login: "dastratakos",
    avatarUrl: DEAN_AVATAR_DATA_URL,
    bot: false,
    userId: MEMBER.DEAN.userId,
  },
  DANA: {
    login: "danamoreno",
    avatarUrl: initialPicture("D", "#f2b880", "#6b3a12"),
    bot: false,
    userId: MEMBER.DANA.userId,
  },
  JORDAN: {
    login: "jordanlee",
    avatarUrl: initialPicture("J", "#9fd8b4", "#1f5135"),
    bot: false,
    userId: MEMBER.JORDAN.userId,
  },
  VERCEL: { login: "vercel[bot]", avatarUrl: VERCEL_MARK, bot: true },
} as const satisfies Record<string, GitHubPerson>;
