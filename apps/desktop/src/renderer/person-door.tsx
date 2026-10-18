import { appPlatform } from "@luke/panel/app-platform";
import { useMemberDirectory } from "@luke/panel/member-directory";
import { ACTOR_KIND, type Actor, SOMEONE_REASON } from "@luke/ui/actor-model";
import { createContext, useContext } from "react";

/**
 * person-door.tsx -- where a press on a person goes: their page in the listed workspace, the page of someone who left, or a GitHub account's own page on GitHub.
 *
 * Every place that names a person draws them through `ActorRef`, which asks
 * here what a press on the name opens, so a byline, an agent's card, an
 * Inbox pick, and Changes all open the same page the same way; a hover card
 * is read, never a door, since the name it hangs from already is one.
 * A member, the reader among them, opens their page (`person-page.tsx`),
 * and so does someone who left, by the account id the service still
 * names them by. Someone GitHub names who is no member opens their GitHub
 * profile in the browser, and an App's bot the App's page, since the
 * window has no page for either. Luke, an agent, and an automation hand
 * their own doors where they are named, and someone nobody names opens
 * nothing. Outside the window's Plans tab, where nobody provides the
 * opener, a person opens nothing either.
 */

/** Opens a person's page by their account id, with the name the place knows them by, in the workspace the place is in. */
type OpenPerson = (userId: string, name?: string, workspaceId?: string) => void;

const OpenPersonContext = createContext<OpenPerson | undefined>(undefined);

/** Hands the window's opener for a person's page to everything under it. */
export const OpenPersonProvider = OpenPersonContext.Provider;

/** The window's opener for a person's page; nothing outside the window. */
export function useOpenPerson(): OpenPerson | undefined {
  return useContext(OpenPersonContext);
}

/** GitHub's own address, which a GitHub account's page stands under. */
const GITHUB_ORIGIN = "https://github.com";

/** What an App's bot's login ends with, which its App's slug comes before. */
const BOT_SUFFIX = "[bot]";

/** A GitHub account's own page: a person's profile, or the App's page for an App's bot. */
export function githubPageOf(login: string, bot: boolean): string {
  const app = bot && login.endsWith(BOT_SUFFIX);
  const path = app ? `apps/${login.slice(0, -BOT_SUFFIX.length)}` : login;
  return new URL(path, `${GITHUB_ORIGIN}/`).href;
}

/** What a press on `actor` opens, where the window can open anything for them; nothing for the rest. */
export function useActorDoor(actor: Actor): (() => void) | undefined {
  const openPerson = useContext(OpenPersonContext);
  // Note that a person is opened in the workspace the place naming them reads its members of, an agent's own where its page stands in another.
  const { workspaceId } = useMemberDirectory();
  if (openPerson === undefined) return undefined;
  switch (actor.kind) {
    case ACTOR_KIND.PERSON: {
      const { userId } = actor;
      return () => openPerson(userId, undefined, workspaceId);
    }
    case ACTOR_KIND.SOMEONE: {
      // Note that someone who left is opened with the name the place knows them by, because their page may find them nowhere else.
      const { userId, name } = actor;
      if (actor.reason !== SOMEONE_REASON.FORMER || userId === undefined) return undefined;
      return () => openPerson(userId, name, workspaceId);
    }
    case ACTOR_KIND.GITHUB: {
      const url = githubPageOf(actor.login, actor.bot);
      return () => appPlatform().openGitHub(url);
    }
    default:
      return undefined;
  }
}
