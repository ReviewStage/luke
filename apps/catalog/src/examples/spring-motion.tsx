/**
 * spring-motion.tsx -- the Motion trial: task cards opening into their detail, the card itself travelling there and back on Motion's shared layout, and notices flung away sideways, a fling carrying its speed; every timing read from the motion tokens.
 */

import { BUTTON_VARIANT, Button, GAP, Stack, TEXT_TONE, TEXT_VARIANT, Text } from "@luke/ui";
import {
  type ExpandingCard,
  ExpandingCards,
  type FlingNotice,
  FlingStack,
} from "@luke/ui/spring-motion";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

const CARDS: readonly ExpandingCard[] = [
  {
    id: "token-refresh",
    title: "Fix the token refresh",
    meta: "ReviewStage/luke · 2 agents",
    detail:
      "A session that sleeps past its token's hour wakes signed out. Refresh the token before the session's first request after a wake, and keep the request waiting on it.",
  },
  {
    id: "invite-flow",
    title: "Review the invite flow",
    meta: "ReviewStage/luke · 1 agent",
    detail:
      "An invitation sent to an address that already has an account should land the member in the workspace without a second sign-up.",
  },
  {
    id: "plan-pictures",
    title: "Pictures in the plan",
    meta: "ReviewStage/luke · waiting on review",
    detail:
      "A picture pasted into the plan is kept beside it, shown to the members who can open the task, and deleted with the plan.",
  },
];

const NOTICES: readonly FlingNotice[] = [
  { id: "copied", words: "Link copied" },
  { id: "archived", words: "Task archived" },
  { id: "merged", words: "Pull request merged" },
  { id: "saved", words: "Plan saved" },
];

function SharedLayout(): React.JSX.Element {
  return (
    <CatalogSection id="spring-motion-shared" title="Opened in place">
      <Stack gap={GAP.FIELD}>
        <ExpandingCards cards={CARDS} closeLabel="Close" />
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          Press a card. Escape or Close puts it back.
        </Text>
      </Stack>
    </CatalogSection>
  );
}

function Fling(): React.JSX.Element {
  const [notices, setNotices] = useState(NOTICES);
  return (
    <CatalogSection id="spring-motion-fling" title="Flung away">
      <Stack gap={GAP.FIELD}>
        {/* Note that the controls stand above the stack, because what stands under it jumps as a notice leaves while the stack glides. */}
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          A quick flick sends a notice however short; a slow drag short of the line swings home.
        </Text>
        <Button variant={BUTTON_VARIANT.OUTLINE} onClick={() => setNotices(NOTICES)}>
          Show them again
        </Button>
        <FlingStack
          notices={notices}
          label="Notices"
          dismissLabel="Dismiss"
          onDismiss={(id) => setNotices((was) => was.filter((notice) => notice.id !== id))}
        />
      </Stack>
    </CatalogSection>
  );
}

function SpringMotion(): React.JSX.Element {
  return (
    <>
      <SharedLayout />
      <Fling />
    </>
  );
}

export const SPRING_MOTION_EXAMPLE: Example = {
  id: "spring-motion",
  title: "Spring motion (Motion trial)",
  Render: SpringMotion,
};
