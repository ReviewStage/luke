import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
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
} from "@repo/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

function noop(): void {}

const ACTION_HOLD_MS = 5000;

const FAILED_HOLD_MS = 6000;

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
      <div className="catalog-toast-stage">
        <ToastStack
          label="Notifications"
          polite="Link copied. Task archived. Should withdrawn invitations count? Linear's sign-in expired"
          alert="Couldn't save the description"
        >
          <Toast tone={STATUS_TONE.COMPLETE} words="Link copied" />
          <Toast
            tone={STATUS_TONE.DANGER}
            words="Couldn't save the description"
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
          <Toast
            tone={STATUS_TONE.ATTENTION}
            mark={INTEGRATION_PROVIDER.LINEAR}
            words="Linear's sign-in expired"
            actions={
              <ToastActions
                label="Reconnect"
                onPress={noop}
                dismissLabel="Dismiss"
                onDismiss={noop}
              />
            }
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

const FAILURE_DETAILS = [
  `${PRODUCT_NAME} error details. Include these when you report this problem:`,
  "time: 2026-10-29T18:20:03.198Z",
  "failure.surface: agent.stop",
  "failure.kind: unexpected",
  "failure.code: TypeError",
].join("\n");

function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

function Failures(): React.JSX.Element {
  const copy = { text: FAILURE_DETAILS, what: "details", copy: copyToClipboard };
  return (
    <CatalogSection id="toast-failure-copy" title="Failures copy their details">
      <div className="catalog-toast-stage">
        <ToastStack
          label="Failure notifications"
          polite=""
          alert="Your description edits could not be saved."
        >
          <Toast
            tone={STATUS_TONE.DANGER}
            words="The agent could not be stopped."
            countdown={FAILED_HOLD_MS}
            actions={<ToastActions copy={copy} dismissLabel="Dismiss" onDismiss={noop} />}
          />
          <Toast
            tone={STATUS_TONE.DANGER}
            words="Your description edits could not be saved."
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

const SAYING = {
  [STATUS_TONE.WORKING]: "Adding to the description…",
  [STATUS_TONE.COMPLETE]: "Added to the description",
  [STATUS_TONE.DANGER]: "The description could not be saved.",
} as const;

type Outcome = keyof typeof SAYING;

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
