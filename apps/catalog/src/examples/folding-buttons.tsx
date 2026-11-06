import {
  BUTTON_SHAPE,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  ComposeIcon,
  ExternalIcon,
  FoldingButton,
  GAP,
  Inline,
  PlusIcon,
  Stack,
  UpdateIcon,
} from "@repo/ui";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

function Acts({ busy = false }: { busy?: boolean }): React.JSX.Element {
  return (
    <Inline gap={GAP.CONTROL}>
      <FoldingButton label="Automations" icon={<ComposeIcon />} />
      <FoldingButton label="Send feedback" icon={<PlusIcon />} />
      <FoldingButton
        label="Run now"
        icon={<PlusIcon />}
        variant={BUTTON_VARIANT.OUTLINE}
        busy={busy}
        busyLabel="Running"
      />
    </Inline>
  );
}

function Tinted(): React.JSX.Element {
  return (
    <Inline gap={GAP.CONTROL}>
      <FoldingButton
        label="Restart"
        icon={<UpdateIcon />}
        variant={BUTTON_VARIANT.WORKING_TINT}
        shape={BUTTON_SHAPE.ROUND}
        size={BUTTON_SIZE.COMPACT}
      />
      <FoldingButton
        label="Download"
        icon={<ExternalIcon />}
        variant={BUTTON_VARIANT.DANGER_TINT}
        shape={BUTTON_SHAPE.ROUND}
        size={BUTTON_SIZE.COMPACT}
      />
    </Inline>
  );
}

function Counted(): React.JSX.Element {
  return (
    <FoldingButton
      label="Todo"
      icon={<PlusIcon />}
      variant={BUTTON_VARIANT.ROW}
      trailing={3}
      aria-expanded
    />
  );
}

function FoldingButtons(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="folding-drawn" title="Words drawn">
        <Acts />
      </CatalogSection>
      <CatalogSection id="folding-folded" title="Folded">
        <div className="catalog-folded">
          <Acts />
        </div>
      </CatalogSection>
      <CatalogSection id="folding-busy" title="Busy, drawn and folded">
        <Stack gap={GAP.CONTROL}>
          <Acts busy />
          <div className="catalog-folded">
            <Acts busy />
          </div>
        </Stack>
      </CatalogSection>
      <CatalogSection id="folding-tinted" title="Round and tinted, drawn and folded">
        <Stack gap={GAP.CONTROL}>
          <Tinted />
          <div className="catalog-folded">
            <Tinted />
          </div>
        </Stack>
      </CatalogSection>
      <CatalogSection id="folding-counted" title="Row look with a count">
        <Counted />
      </CatalogSection>
      <CatalogSection id="folding-toolbar" title="Folding with its toolbar">
        <div className="catalog-folding-toolbar">
          <div>
            <Acts />
          </div>
        </div>
      </CatalogSection>
    </>
  );
}

export const FOLDING_BUTTONS_EXAMPLE: Example = {
  id: "folding-buttons",
  title: "Folding buttons",
  Render: FoldingButtons,
};
