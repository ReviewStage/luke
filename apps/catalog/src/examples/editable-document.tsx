/**
 * editable-document.tsx -- a document edited in place, its title and two sections as blocks the keyboard selects, steps across with ↑ and ↓, and opens with Return, a press on a section's words opening it there, and the title's words edited where they stand.
 */

import {
  EDITABLE_BLOCK_KIND,
  EDITABLE_HEADING_LEAVE,
  EditableBlock,
  EditableHeading,
  PageHeader,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { markdownClass } from "@luke/ui/markdown-class";
import { useLayoutEffect, useRef, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

const SECTIONS = [
  { heading: "Goal", words: "Every control in the panel comes from the design system." },
  { heading: "Rollout", words: "Move the last handlers, then turn the lint guard on." },
];

function EditableDocument(): React.JSX.Element {
  const title = useRef<HTMLElement | null>(null);
  const titleBlock = useRef<HTMLDivElement | null>(null);
  const [heard, setHeard] = useState("Nothing opened yet");
  // The words are the heading's own once drawn, as a plan's title's are.
  useLayoutEffect(() => {
    if (title.current !== null) title.current.textContent = "Turn the lint guard on";
  }, []);
  return (
    <CatalogSection id="editable-document" title="Title and sections">
      <Stack>
        <div className={markdownClass()}>
          <EditableBlock
            ref={titleBlock}
            label="Title"
            kind={EDITABLE_BLOCK_KIND.TITLE}
            entry
            onOpen={() => title.current?.focus()}
          >
            <PageHeader
              title={
                <EditableHeading
                  ref={title}
                  label="Task name"
                  onLeave={(way) => {
                    if (way === EDITABLE_HEADING_LEAVE.BACK) titleBlock.current?.focus();
                    else setHeard("Left the title for the text");
                  }}
                />
              }
            />
          </EditableBlock>
          {SECTIONS.map((section) => (
            <EditableBlock
              key={section.heading}
              label={section.heading}
              kind={EDITABLE_BLOCK_KIND.TEXT}
              entry={false}
              onOpen={() => setHeard(`Opened ${section.heading} at its end`)}
              onPress={({ x, y }) =>
                setHeard(`Opened ${section.heading} at ${String(x)}, ${String(y)}`)
              }
            >
              <Text variant={TEXT_VARIANT.SECTION}>{section.heading}</Text>
              <Text>{section.words}</Text>
            </EditableBlock>
          ))}
        </div>
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {heard}
        </Text>
      </Stack>
    </CatalogSection>
  );
}

export const EDITABLE_DOCUMENT_EXAMPLE: Example = {
  id: "editable-document",
  title: "Editable document",
  Render: EditableDocument,
};
