import { ACT_KIND } from "@luke/host/acts";
import { ACTOR_KIND, type Actor, SOMEONE_REASON } from "@luke/ui/actor-model";
import { createContext, useContext } from "react";
import { useAct } from "./act";

/**
 * person-door.tsx -- where a press on a person goes: their page in the listed workspace, the page of someone who left, or a GitHub account's own page on GitHub.
 *
 * Every place that names a person draws them through `ActorRef` and their
 * card, and both ask here what a press opens, so a byline, an agent's
 * card, an Inbox pick, and Changes all open the same page the same way.
 * A member, the reader among them, opens their page (`person-page.tsx`),
 * and so does someone who left, by the account id the service still
 * names them by. Someone GitHub names who is no member opens their GitHub
 * profile in the browser, and an App's bot the App's page, since the
 * window has no page for either. Luke, an agent, and an automation hand
 * their own doors where they are named, and someone nobody names opens
 * nothing. Outside the window's Plans tab, where nobody provides the
 * opener, a person opens nothing either.
 */

const OpenPersonContext = createContext<((userId: string) => void) | undefined>(undefined);

/** Hands the window's opener for a person's page to everything under it. */
export const OpenPersonProvider = OpenPersonContext.Provider;

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
  const { tell } = useAct();
  if (openPerson === undefined) return undefined;
  switch (actor.kind) {
    case ACTOR_KIND.PERSON: {
      const { userId } = actor;
      return () => openPerson(userId);
    }
    case ACTOR_KIND.SOMEONE: {
      const { userId } = actor;
      if (actor.reason !== SOMEONE_REASON.FORMER || userId === undefined) return undefined;
      return () => openPerson(userId);
    }
    case ACTOR_KIND.GITHUB: {
      const url = githubPageOf(actor.login, actor.bot);
      return () => tell(ACT_KIND.GITHUB_OPEN, { url });
    }
    default:
      return undefined;
  }
}
