/**
 * toasts.tsx -- the passing notices in each tone, stacked as the window stacks
 * them: a plain one that lets clicks through, one with a second line, and
 * ones carrying an action, whose × shows under the pointer or focus, the
 * Undo one draining its countdown, paused under the pointer; then one whose
 * work is under way, turned in place into done or failed by a press, and
 * one to drag or sweep sideways away, shown again by a press; and failures
 * that offer their details to copy, alone and beside a Retry.
 */

import {
  BUTTON_VARIANT,
  Button,
  GAP,
  Inline,
  STATUS_TONE,
  Toast,
  ToastActions,
  ToastStack,
  type ToastTone,
} from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

function noop(): void {}

/** How long the Undo toast's countdown runs, as the window's hold for a toast with an action. */
const ACTION_HOLD_MS = 5000;

/** How long a failure toast's countdown runs, as the window's hold for a refusal. */
const FAILED_HOLD_MS = 6000;

/** A toast with an action, as an undoable change carries one. */
function Acting({
  tone,
  words,
  detail,
  label,
  href,
  countdown,
}: {
  tone: ToastTone;
  words: string;
  detail?: string;
  label: string;
  /** The page the action opens, drawn as a link in the action's look. */
  href?: string;
  countdown?: number;
}): React.JSX.Element {
  return (
    <Toast
      tone={tone}
      words={words}
      detail={detail}
      countdown={countdown}
      actions={
        <ToastActions
          label={label}
          href={href}
          onPress={href === undefined ? noop : () => window.open(href, "_blank", "noreferrer")}
          dismissLabel="Dismiss"
          onDismiss={noop}
        />
      }
    />
  );
}

function Toasts(): React.JSX.Element {
  return (
    <CatalogSection id="toast-stack" title="Stacked in the corner">
      {/* A transform makes this box the containing block of the stack's fixed corner. */}
      <div className="catalog-toast-stage">
        <ToastStack
          label="Notifications"
          polite="Link copied. Task archived. Should withdrawn invitations count?"
          alert="Couldn't save the plan"
        >
          <Toast tone={STATUS_TONE.COMPLETE} words="Link copied" />
          <Toast
            tone={STATUS_TONE.DANGER}
            words="Couldn't save the plan"
            detail="Your change is kept here until you are back online."
          />
          <Acting
            tone={STATUS_TONE.COMPLETE}
            words="Task archived"
            label="Undo"
            countdown={ACTION_HOLD_MS}
          />
          <Acting
            tone={STATUS_TONE.ATTENTION}
            words="Should withdrawn invitations count?"
            detail="Relay · Retry the webhook"
            label="View"
          />
          <Acting
            tone={STATUS_TONE.DANGER}
            words="Your OpenAI account is out of credit."
            label="Add credit"
            href="https://platform.openai.com/settings/organization/billing/overview"
          />
        </ToastStack>
      </div>
    </CatalogSection>
  );
}

/** What a failure's Copy details puts on the clipboard, as the panel builds it from the failure's report. */
const FAILURE_DETAILS = [
  "Luke showed an error. Find it in Sentry and the logs by these details:",
  "time: 2026-10-29T18:20:03.198Z",
  "failure.surface: agent.stop",
  "failure.kind: unexpected",
  "failure.code: TypeError",
].join("\n");

/** A catalog's clipboard: the browser's own. */
function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

/** Failure toasts, each offering its details to copy: one with nothing else to press, and one beside its Retry. */
function Failures(): React.JSX.Element {
  const copy = { text: FAILURE_DETAILS, what: "details", copy: copyToClipboard };
  return (
    <CatalogSection id="toast-failure-copy" title="Failures copy their details">
      <div className="catalog-toast-stage">
        <ToastStack
          label="Failure notifications"
          polite=""
          alert="Your plan edits could not be saved."
        >
          <Toast
            tone={STATUS_TONE.DANGER}
            words="The agent could not be stopped."
            countdown={FAILED_HOLD_MS}
            actions={<ToastActions copy={copy} dismissLabel="Dismiss" onDismiss={noop} />}
          />
          <Toast
            tone={STATUS_TONE.DANGER}
            words="Your plan edits could not be saved."
            actions={
              <ToastActions
                label="Retry"
                onPress={noop}
                copy={copy}
                dismissLabel="Dismiss"
                onDismiss={noop}
              />
            }
          />
        </ToastStack>
      </div>
    </CatalogSection>
  );
}

/** What the working toast says, by what came of its work. */
const SAYING = {
  [STATUS_TONE.WORKING]: "Adding to the plan…",
  [STATUS_TONE.COMPLETE]: "Added to the plan",
  [STATUS_TONE.DANGER]: "The plan could not be saved.",
} as const;

type Outcome = keyof typeof SAYING;

/** A working toast, turned in place by a press into what came of its work. */
function Working(): React.JSX.Element {
  const [tone, setTone] = useState<Outcome>(STATUS_TONE.WORKING);
  return (
    <CatalogSection id="toast-working" title="Working, then done in place">
      <Inline gap={GAP.CONTROL}>
        <Button variant={BUTTON_VARIANT.OUTLINE} onClick={() => setTone(STATUS_TONE.WORKING)}>
          Start
        </Button>
        <Button variant={BUTTON_VARIANT.OUTLINE} onClick={() => setTone(STATUS_TONE.COMPLETE)}>
          Succeed
        </Button>
        <Button variant={BUTTON_VARIANT.OUTLINE} onClick={() => setTone(STATUS_TONE.DANGER)}>
          Fail
        </Button>
      </Inline>
      <div className="catalog-toast-stage">
        <ToastStack label="Working notifications" polite={SAYING[tone]} alert="">
          <Toast tone={tone} words={SAYING[tone]} />
        </ToastStack>
      </div>
    </CatalogSection>
  );
}

/** A toast to drag or sweep sideways away, drawn anew by a press once it has gone. */
function Swiped(): React.JSX.Element {
  const [shown, setShown] = useState({ count: 0, leaving: false });
  const dismiss = () => setShown({ ...shown, leaving: true });
  return (
    <CatalogSection id="toast-swipe" title="Swiped away">
      <Button
        variant={BUTTON_VARIANT.OUTLINE}
        onClick={() => setShown({ count: shown.count + 1, leaving: false })}
      >
        Show again
      </Button>
      <div className="catalog-toast-stage">
        <ToastStack label="Swipeable notifications" polite="Task archived" alert="">
          <Toast
            key={shown.count}
            tone={STATUS_TONE.COMPLETE}
            words="Task archived"
            detail="Drag or sweep it sideways"
            leaving={shown.leaving}
            onEscape={dismiss}
            actions={
              <ToastActions
                label="Undo"
                onPress={noop}
                dismissLabel="Dismiss"
                onDismiss={dismiss}
              />
            }
          />
        </ToastStack>
      </div>
    </CatalogSection>
  );
}

function AllToasts(): React.JSX.Element {
  return (
    <>
      <Toasts />
      <Failures />
      <Working />
      <Swiped />
    </>
  );
}

export const TOASTS_EXAMPLE: Example = { id: "toasts", title: "Toasts", Render: AllToasts };
