/**
 * view-transition.tsx -- screen-to-screen continuity: React's `<ViewTransition>` boundaries, each listening for one kind of navigation.
 *
 * A trial of the browser's View Transitions API as React 19.3 drives it. A
 * navigation is a state update run inside `startTransition` and tagged with
 * its kind (`navigate`); only the boundaries listening for that kind move,
 * and every boundary here is `default="none"`, so a streamed reply, a
 * Suspense reveal, or a deferred value elsewhere in the window moves nothing.
 * The browser snapshots the window before and after the update and plays the
 * pseudo-elements between the two pictures, which `view-transition.css` times
 * on the motion tokens, so reduced motion and a capture run, which zero them,
 * hold every one still.
 *
 * What moves is a picture of the words, never the words: the boundary's box
 * is captured as an image and that image is moved, scaled, and faded, so
 * nothing lays text out again mid-motion (docs/DESIGN.md).
 */

import { addTransitionType, startTransition, ViewTransition } from "react";

/** The kinds of navigation a boundary listens for; one tagged with none of them moves nothing. */
export const NAVIGATION = {
  /** A task opened from a row naming it, or left back to the list: its title travels between the two. */
  TASK_OPEN: "luke-task-open",
  /** Another tab of the side panel chosen: its body fades through to the tab chosen. */
  SIDE_TAB: "luke-side-tab",
} as const;

export type Navigation = (typeof NAVIGATION)[keyof typeof NAVIGATION];

/** The view-transition classes `view-transition.css` times, one per motion a boundary plays. */
const TRAVEL_CLASS = "luke-vt-travel";
const SWAP_CLASS = "luke-vt-swap";

/**
 * The name a task's title travels under between its row and its page. Note
 * that it is spelled here alone, because a view-transition name is a CSS
 * identifier the browser pairs the two pictures by, and a task's id, a
 * UUID, is no identifier until something that starts with a letter leads it.
 */
function taskTitleName(taskId: string): string {
  return `luke-task-title-${taskId}`;
}

/** Runs `update` as a navigation of the kind given, so the boundaries listening for it move. */
export function navigate(kind: Navigation, update: () => void): void {
  startTransition(() => {
    addTransitionType(kind);
    update();
  });
}

/**
 * A task's title, which travels between a row naming it and the task's page
 * as one turns into the other: the browser pairs the title leaving with the
 * one arriving by their name. A name is worn by one place at a time, so a
 * place that may stand beside another naming the same task wears it only
 * while `travels` says so; turning it off draws the title afresh, which is
 * what lets a row that stays on screen, the sidebar's, hand its title over
 * to the page in the same update that opens it. Its box hugs the words, so
 * the picture that travels is the words' and not the row's width of nothing
 * beside them.
 */
export function TaskTitleTransition({
  taskId,
  travels = true,
  children,
}: {
  taskId: string;
  /** Whether this place's title is the one that travels; the page's always is. */
  travels?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return travels ? (
    <ViewTransition
      key="travels"
      name={taskTitleName(taskId)}
      default="none"
      share={{ [NAVIGATION.TASK_OPEN]: TRAVEL_CLASS, default: "none" }}
    >
      <span className="luke-task-title-transition">{children}</span>
    </ViewTransition>
  ) : (
    <ViewTransition key="stays" default="none">
      <span className="luke-task-title-transition">{children}</span>
    </ViewTransition>
  );
}

/**
 * The body of a set of tabs, which fades through to the tab chosen: what
 * stood fades out first, and the tab chosen fades in rising, as arriving
 * content does. Its children are the body's own boxes, each a picture of
 * its own, so a tab kept mounted while hidden fades out as it is hidden.
 */
export function TabBodyTransition({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <ViewTransition default="none" update={{ [NAVIGATION.SIDE_TAB]: SWAP_CLASS, default: "none" }}>
      {children}
    </ViewTransition>
  );
}
