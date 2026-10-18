import { ATTACHMENT_CHIP_STATE, AttachmentChip, ImageIcon } from "@luke/ui";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * attachment-chips.tsx -- a row of files coming along with a message: a
 * picture's thumbnail, files drawn by name and size, one with nothing to
 * open, a long name cut short, and the way off each, unavailable while busy;
 * then the same chips in a narrow column, and a call's pictures still read,
 * gone, and not kept.
 */

/** A synthetic picture drawn in place, so the catalog renders offline. */
const PICTURE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 48"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="#7aa7f4"/><stop offset="1" stop-color="#3d5ac8"/></linearGradient></defs><rect width="64" height="48" fill="url(#g)"/><path d="M0 40l18-14 12 10 14-12 20 16v8H0z" fill="#fff8"/></svg>',
)}`;

interface SampleFile {
  readonly name: string;
  readonly image?: string;
  readonly detail?: string;
  readonly openable: boolean;
}

const FILES: readonly SampleFile[] = [
  { name: "screenshot.png", image: PICTURE, openable: true },
  { name: "spec.pdf", detail: "48 KB", openable: true },
  {
    name: "quarterly-revenue-forecast-with-every-region-broken-out.csv",
    detail: "1.2 MB",
    openable: true,
  },
  { name: "trace.txt", openable: false },
];

/** The sample row: a press on a chip says which file it opened, and each one's way off takes it off. */
function AttachmentRow({ busy }: { busy: boolean }): React.JSX.Element {
  const [files, setFiles] = useState(FILES);
  const [opened, setOpened] = useState<string>();
  return (
    <>
      <ul className="catalog-attachments" aria-label="Attached files">
        {files.map((file) => (
          <AttachmentChip
            key={file.name}
            name={file.name}
            image={file.image}
            icon={<ImageIcon />}
            detail={file.detail}
            onOpen={file.openable ? () => setOpened(file.name) : undefined}
            onRemove={() => setFiles((now) => now.filter((each) => each !== file))}
            removeDisabled={busy}
          />
        ))}
      </ul>
      <p>{opened === undefined ? "Nothing opened" : `Opened ${opened}`}</p>
    </>
  );
}

function AttachmentChips(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="attachment-chip-row" title="A message's files">
        <AttachmentRow busy={false} />
      </CatalogSection>
      <CatalogSection id="attachment-chip-busy" title="While sending">
        <AttachmentRow busy />
      </CatalogSection>
      <CatalogSection id="attachment-chip-states" title="Still read, and failed">
        <ul className="catalog-attachments" aria-label="Pictures the call answered">
          <AttachmentChip name="dashboard.png" state={ATTACHMENT_CHIP_STATE.LOADING} />
          <AttachmentChip
            name="chart.png"
            icon={<ImageIcon />}
            state={ATTACHMENT_CHIP_STATE.FAILED}
          />
          <AttachmentChip
            name="full-page.png"
            icon={<ImageIcon />}
            state={ATTACHMENT_CHIP_STATE.FAILED}
            failure="Not kept"
            detail="6.2 MB"
          />
        </ul>
      </CatalogSection>
      <CatalogSection id="attachment-chip-narrow" title="Narrow column, long names">
        <div className="catalog-narrow">
          <AttachmentRow busy={false} />
        </div>
      </CatalogSection>
    </>
  );
}

export const ATTACHMENT_CHIPS_EXAMPLE: Example = {
  id: "attachment-chips",
  title: "Attachment chips",
  Render: AttachmentChips,
};
