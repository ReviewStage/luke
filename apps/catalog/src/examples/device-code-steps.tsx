import {
  BUTTON_VARIANT,
  Button,
  ButtonLink,
  COPY_FIELD_WIDTH,
  CopyField,
  DIALOG_SIZE,
  Dialog,
  ErrorLine,
  GAP,
  Inline,
  NumberedStep,
  NumberedSteps,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  WaitingLine,
} from "@repo/ui";
import { useState } from "react";
import { CATALOG_FAILURE } from "../catalog-failure";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * device-code-steps.tsx -- a code entered on another site, said as two
 * numbered steps (a hint, then a code to copy over a page to open) and the
 * wait on the other site under them, drawn alone and in
 * a dialog with a line under its title and a close at its end, waiting or
 * ended in a failure with Try again. The catalog's copy act is the
 * browser's own clipboard, and its presses go nowhere.
 */

const copyToClipboard = (text: string): Promise<void> => navigator.clipboard.writeText(text);

const VERIFICATION_URL = "https://example.com/device";

/** The refusal the failed dialog says. */
const EXPIRED = {
  words: "The code expired before it was entered. Try again.",
  failure: CATALOG_FAILURE,
};

/** Where the dialog is opened at: waiting on the code, or ended in a failure. */
const STANDING = {
  WAITING: "waiting",
  FAILED: "failed",
} as const;

type Standing = (typeof STANDING)[keyof typeof STANDING];

/** The two steps, and the wait under them, as siblings so a dialog's card spaces them at its own gap. */
function Steps(): React.JSX.Element {
  return (
    <>
      <NumberedSteps>
        <NumberedStep number={1} title="Turn on device codes in your account's security settings">
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            If you don't see this option, ask your workspace admin to turn it on
          </Text>
        </NumberedStep>
        <NumberedStep number={2} title="Sign in and enter the code:">
          <CopyField
            label="Code"
            value="225Q-1343X"
            what="code"
            copy={copyToClipboard}
            width={COPY_FIELD_WIDTH.HUG}
          />
          <Inline>
            <ButtonLink href={VERIFICATION_URL} variant={BUTTON_VARIANT.OUTLINE} external>
              Verification page
            </ButtonLink>
          </Inline>
        </NumberedStep>
      </NumberedSteps>
      <WaitingLine>Waiting for the other site</WaitingLine>
    </>
  );
}

/** The steps in a dialog, opened waiting or failed, put away by its close, Escape, or a press on the dimmed window. */
function StepsDialog(): React.JSX.Element {
  const [standing, setStanding] = useState<Standing | undefined>(undefined);
  const close = () => setStanding(undefined);
  return (
    <>
      <Inline gap={GAP.CONTROL}>
        <Button variant={BUTTON_VARIANT.OUTLINE} onClick={() => setStanding(STANDING.WAITING)}>
          Open waiting
        </Button>
        <Button variant={BUTTON_VARIANT.OUTLINE} onClick={() => setStanding(STANDING.FAILED)}>
          Open failed
        </Button>
      </Inline>
      <Dialog
        open={standing !== undefined}
        title="Connect a device"
        subtitle="Use your own subscription for this provider's models"
        closeLabel="Close"
        size={DIALOG_SIZE.WIDE}
        onDismiss={close}
      >
        {standing === STANDING.FAILED ? (
          <Stack gap={GAP.CONTROL}>
            <ErrorLine error={EXPIRED} />
            <Inline>
              <Button
                variant={BUTTON_VARIANT.PRIMARY}
                onClick={() => setStanding(STANDING.WAITING)}
              >
                Try again
              </Button>
            </Inline>
          </Stack>
        ) : (
          <Steps />
        )}
      </Dialog>
    </>
  );
}

function DeviceCodeSteps(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="steps-dialog" title="In a dialog, with a line under its title and close">
        <StepsDialog />
      </CatalogSection>
      <CatalogSection id="numbered-steps" title="Numbered steps, and the wait under them">
        <Stack gap={GAP.BLOCK}>
          <Steps />
        </Stack>
      </CatalogSection>
    </>
  );
}

export const DEVICE_CODE_STEPS_EXAMPLE: Example = {
  id: "device-code-steps",
  title: "Device code steps",
  Render: DeviceCodeSteps,
};
