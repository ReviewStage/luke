import { EmptyState, type EmptyStateAction } from "@luke/ui";
import { SearchXIcon } from "lucide-react";

/**
 * not-found.tsx -- the window's one answer to a place it cannot show: a task, an agent, an automation, or an Inbox item that is not there for whoever opened it, and the admin dashboard's for an account.
 *
 * A link to anything in Luke may reach someone the thing is not shared
 * with, and the service answers them as it answers a thing that does not
 * exist, so a link never says that something private is there, as GitHub's
 * own 404 does. The window says the same for both, in the place the thing
 * would stand, and draws nothing of it: no name, no words, nothing a read
 * the reader was refused could carry. A thing deleted while it stood open
 * says the same.
 */

/** What the state calls the thing it could not show. */
export const NOT_FOUND_THING = {
  TASK: "task",
  AGENT: "agent",
  INBOX_ITEM: "Inbox item",
  AUTOMATION: "automation",
  PERSON: "profile",
  ACCOUNT: "account",
} as const;

type NotFoundThing = (typeof NOT_FOUND_THING)[keyof typeof NOT_FOUND_THING];

/** The state's title, the same for every thing. */
const NOT_FOUND_TITLE = "Not found";

/** The place a thing would stand, saying it is not there or not the reader's, with the one way on from it where one is given. */
export function NotFound({
  thing,
  action,
}: {
  thing: NotFoundThing;
  action?: EmptyStateAction | undefined;
}): React.JSX.Element {
  return (
    <EmptyState icon={<SearchXIcon />} title={NOT_FOUND_TITLE} action={action}>
      {`This ${thing} doesn't exist, or you don't have access to it.`}
    </EmptyState>
  );
}
