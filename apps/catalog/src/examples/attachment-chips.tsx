import {
  ATTACHMENT_CHIP_STATE,
  AttachmentChip,
  BUTTON_VARIANT,
  Button,
  ImageIcon,
  LIST_MOTION_WAY,
  ListMotion,
  motionRows,
  useLeaving,
} from "@luke/ui";
import { type RefObject, useRef, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * attachment-chips.tsx -- a row of files coming along with a message: a
 * picture's thumbnail, files drawn by name and size, one with nothing to
 * open, a long name cut short, and the way off each, unavailable while busy,
 * each file taken off scaling out under the row's `ListMotion`;
 * then the same chips in a narrow column, a call's pictures still read,
 * gone, and not kept, and files going up, at a share and with none, which
 * land on a press, each taking its check.
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

/** The row's chips, each followed by its file's name, in a component of their own under the row's `ListMotion`, whose context `useLeaving` reads, so a file taken off scales out. */
function AttachmentList({
  row,
  files,
  busy,
  onOpen,
  onRemove,
}: {
  row: RefObject<HTMLUListElement | null>;
  files: readonly SampleFile[];
  busy: boolean;
  onOpen: (name: string) => void;
  onRemove: (file: SampleFile) => void;
}): React.JSX.Element {
  const drawn = useLeaving(files, (file) => file.name);
  return (
    <ul ref={row} className="catalog-attachments" aria-label="Attached files" {...motionRows()}>
      {drawn.map(({ key, value: file, leaving }) => (
        <AttachmentChip
          key={key}
          motionKey={key}
          name={file.name}
          image={file.image}
          icon={<ImageIcon />}
          detail={file.detail}
          onOpen={file.openable && !leaving ? () => onOpen(file.name) : undefined}
          onRemove={leaving ? undefined : () => onRemove(file)}
          removeDisabled={busy}
        />
      ))}
    </ul>
  );
}

/** The sample row: a press on a chip says which file it opened, and each one's way off takes it off. */
function AttachmentRow({ busy }: { busy: boolean }): React.JSX.Element {
  const [files, setFiles] = useState(FILES);
  const [opened, setOpened] = useState<string>();
  const row = useRef<HTMLUListElement | null>(null);
  return (
    <>
      <ListMotion root={row} way={LIST_MOTION_WAY.SCALE}>
        <AttachmentList
          row={row}
          files={files}
          busy={busy}
          onOpen={setOpened}
          onRemove={(file) => setFiles((now) => now.filter((each) => each !== file))}
        />
      </ListMotion>
      <p>{opened === undefined ? "Nothing opened" : `Opened ${opened}`}</p>
    </>
  );
}

/** Files on their way up: one at a known share, one whose send says none; a press lands them. */
function UploadingRow(): React.JSX.Element {
  const [landed, setLanded] = useState(false);
  const state = landed ? ATTACHMENT_CHIP_STATE.READY : ATTACHMENT_CHIP_STATE.UPLOADING;
  return (
    <>
      <ul className="catalog-attachments" aria-label="Files going up">
        <AttachmentChip name="screenshot.png" image={PICTURE} state={state} progress={64} />
        <AttachmentChip name="spec.pdf" icon={<ImageIcon />} detail="48 KB" state={state} />
      </ul>
      <Button variant={BUTTON_VARIANT.OUTLINE} onClick={() => setLanded((now) => !now)}>
        {landed ? "Send again" : "Land them"}
      </Button>
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
      <CatalogSection id="attachment-chip-uploading" title="Going up">
        <UploadingRow />
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
