import { COPY_FIELD_PROMPT, COPY_FIELD_WIDTH, CopyField, STEP_STATE, Step, Steps } from "@repo/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

const copyToClipboard = (text: string): Promise<void> => navigator.clipboard.writeText(text);

function StepsExample(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="steps-start" title="The first to do now">
        <Steps>
          <Step number={1} title="Run this in a terminal" state={STEP_STATE.CURRENT}>
            <CopyField
              label="Setup-token command"
              value="claude setup-token"
              what="command"
              copy={copyToClipboard}
              width={COPY_FIELD_WIDTH.FULL}
              prompt={COPY_FIELD_PROMPT.SHELL}
            />
          </Step>
          <Step number={2} title="Paste the token it prints" state={STEP_STATE.TO_DO} />
        </Steps>
      </CatalogSection>
      <CatalogSection id="steps-done" title="The first done">
        <Steps>
          <Step number={1} title="Run this in a terminal" state={STEP_STATE.DONE} />
          <Step number={2} title="Paste the token it prints" state={STEP_STATE.CURRENT} />
        </Steps>
      </CatalogSection>
    </>
  );
}

export const STEPS_EXAMPLE: Example = {
  id: "steps",
  title: "Steps",
  Render: StepsExample,
};
