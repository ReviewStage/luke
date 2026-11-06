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

const copyToClipboard = (text: string): Promise<void> => navigator.clipboard.writeText(text);

const VERIFICATION_URL = "https://example.com/device";

const EXPIRED = {
  words: "The code expired before it was entered. Try again.",
  failure: CATALOG_FAILURE,
};

const STANDING = {
  WAITING: "waiting",
  FAILED: "failed",
} as const;

type Standing = (typeof STANDING)[keyof typeof STANDING];

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
