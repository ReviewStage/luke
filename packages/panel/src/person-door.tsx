import { ACTOR_KIND, type Actor, SOMEONE_REASON } from "@repo/ui/actor-model";
import { createContext, useContext, useEffect } from "react";
import { appPlatform } from "./app-platform.js";
import { useMemberDirectory } from "./member-directory.js";

type OpenPerson = (userId: string, name?: string, workspaceId?: string) => void;

const OpenPersonContext = createContext<OpenPerson | undefined>(undefined);

export const OpenPersonProvider = OpenPersonContext.Provider;

export function useOpenPerson(): OpenPerson | undefined {
  return useContext(OpenPersonContext);
}

type PreloadPerson = (userId: string, workspaceId?: string) => void;

const PreloadPersonContext = createContext<PreloadPerson | undefined>(undefined);

export const PreloadPersonProvider = PreloadPersonContext.Provider;

export function usePreloadedPerson(userId: string): void {
  const preload = useContext(PreloadPersonContext);
  const { workspaceId } = useMemberDirectory();
  useEffect(() => preload?.(userId, workspaceId), [preload, userId, workspaceId]);
}

const GITHUB_ORIGIN = "https://github.com";

const BOT_SUFFIX = "[bot]";

function githubPageOf(login: string, bot: boolean): string {
  const app = bot && login.endsWith(BOT_SUFFIX);
  const path = app ? `apps/${login.slice(0, -BOT_SUFFIX.length)}` : login;
  return new URL(path, `${GITHUB_ORIGIN}/`).href;
}

export function useActorDoor(actor: Actor): (() => void) | undefined {
  const openPerson = useContext(OpenPersonContext);
  const { workspaceId } = useMemberDirectory();
  if (openPerson === undefined) return undefined;
  switch (actor.kind) {
    case ACTOR_KIND.PERSON: {
      const { userId } = actor;
      return () => openPerson(userId, undefined, workspaceId);
    }
    case ACTOR_KIND.SOMEONE: {
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
