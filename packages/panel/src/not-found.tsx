import { EmptyState, type EmptyStateAction } from "@repo/ui";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { SearchXIcon } from "lucide-react";

export const NOT_FOUND_THING = {
  TASK: "task",
  AGENT: "agent",
  INBOX_ITEM: "inbox item",
  THREAD: "thread",
  AUTOMATION: "automation",
  PERSON: "profile",
  ACCOUNT: "account",
  WORKSPACE: "workspace",
} as const;

type NotFoundThing = (typeof NOT_FOUND_THING)[keyof typeof NOT_FOUND_THING];

const NOT_FOUND_TITLE = "Not found";

export function NotFound({
  thing,
  action,
}: {
  thing: NotFoundThing;
  action?: EmptyStateAction | undefined;
}): React.JSX.Element {
  return (
    <EmptyState icon={<SearchXIcon />} title={NOT_FOUND_TITLE} action={action} replayUnmasked>
      <ReplayUnmask>{`This ${thing} doesn't exist, or you don't have access to it.`}</ReplayUnmask>
    </EmptyState>
  );
}
