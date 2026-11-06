import {
  BUTTON_VARIANT,
  ButtonLink,
  COPY_FIELD_WIDTH,
  COPY_LOOK,
  CopyButton,
  CopyField,
  DialogHead,
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
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * device-code-steps.tsx -- a code entered on another site, said as one
 * step of a flow: its head with back and close, three numbered steps (a
 * hint, a code to copy, a page to open beside a labeled Copy link), and the
 * wait on the other site under them. The catalog's copy act is the
 * browser's own clipboard, and its presses go nowhere.
 */

const copyToClipboard = (text: string): Promise<void> => navigator.clipboard.writeText(text);

const VERIFICATION_URL = "https://example.com/device";

const nothing = (): void => undefined;

function DeviceCodeSteps(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="dialog-head" title="A step's head, with back and close">
        <DialogHead
          titleId="catalog-dialog-head"
          title="Connect Codex"
          subtitle="Use your own subscription for this provider's models"
          backLabel="Back"
          backTo="Codex"
          closeLabel="Close"
          onBack={nothing}
          onClose={nothing}
        />
      </CatalogSection>
      <CatalogSection id="numbered-steps" title="Numbered steps, and the wait under them">
        <Stack gap={GAP.SECTION}>
          <NumberedSteps>
            <NumberedStep
              number={1}
              title="Turn on device codes in your account's security settings"
            >
              <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                If the switch is hidden, ask your workspace owner to turn it on
              </Text>
            </NumberedStep>
            <NumberedStep number={2} title="Copy this code">
              <CopyField
                label="Code"
                value="225Q-1343X"
                what="code"
                copy={copyToClipboard}
                width={COPY_FIELD_WIDTH.FULL}
              />
            </NumberedStep>
            <NumberedStep number={3} title="Sign in and enter the code">
              <Inline gap={GAP.CONTROL}>
                <ButtonLink href={VERIFICATION_URL} variant={BUTTON_VARIANT.OUTLINE} external>
                  Verification page
                </ButtonLink>
                <CopyButton
                  look={COPY_LOOK.BUTTON}
                  text={VERIFICATION_URL}
                  what="link"
                  copy={copyToClipboard}
                />
              </Inline>
            </NumberedStep>
          </NumberedSteps>
          <WaitingLine hint="Only continue if you started this sign-in here">
            Waiting for the other site
          </WaitingLine>
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
