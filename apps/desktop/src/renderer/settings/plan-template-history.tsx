import type { AccountSnapshot } from "@luke/credentials/snapshot";
import { PLAN_ACTOR, type PlanRevisionLine } from "@luke/features/task-wire";
import { TASK_CALL_FAILURE } from "@luke/features/tasks-view";
import { ACT_KIND } from "@luke/host/acts";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { useEffect, useMemo, useRef } from "react";
import { useAct } from "../act";
import { useAppCommand } from "../app-commands";
import type { CallCardInput } from "../call/call-card";
import { DesktopVersionHistory, type VersionSubject } from "../desktop/desktop-version-history";
import type { SidebarCollapse } from "../desktop/sidebar-collapse";
import { MOUSE_BUTTON, type NavigationHistory } from "../navigation-history";
import { revisionSummary } from "../tasks/plan-history-model";
import { type PlanHistorySource, usePlanHistory } from "../tasks/use-plan-history";
import { sayRestored } from "../tasks/version-view";
import { useToast } from "../toast";
import { TEMPLATE_DOCUMENT_ID, TEMPLATE_TITLE } from "./plan-template-page";

/**
 * plan-template-history.tsx -- the plan template's version history: the plan's own view over the account's template revisions.
 *
 * A template is a plan's text before it is a plan, so its history is drawn
 * exactly as a plan's is (`../desktop/desktop-version-history.tsx`), over
 * the whole window, from the template's title line or its "Edited by"
 * line: every revision listed where the sidebar stands, newest first, each
 * the developer's under their picture as You, or the template as it stood
 * before its history began; the one chosen drawn beside them under the
 * page's title, what it changed marked; and Restore, which puts it back as a
 * revision of its own and offers its Undo in the window's toast. Nothing
 * else in the window writes the template, so a revision opens nowhere. A
 * revision that is the built-in default says so: a reset, or the default the
 * account held when its history began.
 */

/** What a revision that is the built-in default did, by its writer. */
const DEFAULT_SUMMARY = {
  RESET: "Reset to the default",
  EARLIER: "The default template",
} as const;

/** What the template before its history began did. */
const EARLIER_SUMMARY = "The template before its history began";

/** A read the service did not answer, as the history hears one. */
const UNANSWERED = { failure: TASK_CALL_FAILURE.UNANSWERED } as const;

/**
 * What a template revision did, in a few words: the version a restore
 * brought back, a reset, the default or the template the account held when
 * its history began, or how many changes its saves made.
 */
function templateRevisionSummary(line: PlanRevisionLine & { default?: true }): string {
  const earlier = line.lastEdit.actor === PLAN_ACTOR.EARLIER;
  if (line.restoredFrom !== undefined) return revisionSummary(line);
  if (line.default === true) return earlier ? DEFAULT_SUMMARY.EARLIER : DEFAULT_SUMMARY.RESET;
  return earlier ? EARLIER_SUMMARY : revisionSummary(line);
}

/**
 * The history as one step over the template page, which the window's own
 * history does not hold: Back, from the arrow at the list's head, its chord,
 * or the mouse's back button, goes to the page rather than out of Settings.
 * Note that the mouse's press is taken as it starts down the window, before
 * the window's history hears it, because both listen on the window.
 */
function useStepOverTemplate(history: NavigationHistory, onExit: () => void): NavigationHistory {
  const exit = useRef(onExit);
  exit.current = onExit;
  useAppCommand(APP_COMMAND.BACK, onExit);
  useEffect(() => {
    const takeBack = (event: MouseEvent) => {
      if (event.button !== MOUSE_BUTTON.BACK) return;
      event.stopImmediatePropagation();
      exit.current();
    };
    window.addEventListener("mouseup", takeBack, { capture: true });
    return () => window.removeEventListener("mouseup", takeBack, { capture: true });
  }, []);
  return { ...history, canGoBack: true, onBack: onExit };
}

/**
 * The account's plan template's version history over the whole window.
 * `onExit` goes back to the template page, which a restore that lands does
 * too, where the template is read afresh.
 */
export function TemplateVersionHistory({
  sidebar,
  history,
  account,
  call,
  onExit,
}: {
  sidebar: SidebarCollapse;
  history: NavigationHistory;
  /** Who is reading, whose revisions are drawn as theirs. */
  account: AccountSnapshot;
  /** The call card, at the foot of the versions. */
  call: CallCardInput | undefined;
  onExit: () => void;
}): React.JSX.Element {
  const { act } = useAct();
  const toast = useToast();
  const steps = useStepOverTemplate(history, onExit);
  // The history's reads name a task, and the template is the account's one, so the id they carry is no one's.
  const source = useMemo(
    (): PlanHistorySource => ({
      readPage: (_template, before) =>
        act(ACT_KIND.PLAN_TEMPLATE_REVISIONS, before === undefined ? {} : { before }).then(
          (page) => ("failure" in page ? UNANSWERED : page),
        ),
      readRevision: (_template, seq) =>
        act(ACT_KIND.PLAN_TEMPLATE_REVISION, { seq }).then((read) =>
          "failure" in read ? UNANSWERED : read,
        ),
      restore: (_template, seq) =>
        act(ACT_KIND.PLAN_TEMPLATE_RESTORE, { seq }).then((kept) => !("failure" in kept)),
    }),
    [act],
  );
  const versions = usePlanHistory({
    source,
    taskId: TEMPLATE_DOCUMENT_ID,
    editedAt: undefined,
    name: TEMPLATE_TITLE,
    shown: true,
    seek: undefined,
    returnTo: undefined,
    onRestored: (undo) => sayRestored(toast, undo),
  });
  const subject: VersionSubject = {
    versions,
    noun: "template",
    title: TEMPLATE_TITLE,
    restorable: true,
    shown: true,
    agents: [],
    summary: templateRevisionSummary,
    onShowSource: undefined,
    own: true,
    workspace: undefined,
  };
  return (
    <DesktopVersionHistory
      sidebar={sidebar}
      history={steps}
      subject={subject}
      account={account}
      call={call}
      onExit={onExit}
      onRestored={onExit}
    />
  );
}
