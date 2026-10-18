import {
  AnchoredPopover,
  BUTTON_VARIANT,
  Button,
  GAP,
  Inline,
  POPOVER_ALIGN,
  POPOVER_PANEL_LOOK,
  PopoverPanel,
  type PopoverPanelLook,
  SearchField,
  TEXT_TONE,
  Text,
} from "@luke/ui";
import { useId, useRef, useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * popover-panels.tsx -- a panel hung from its button: a card with its title
 * and ×, and a menu whose search field is its head and takes the focus.
 * Each closes on Escape, its ×, a second press of its button, and focus
 * leaving it, and hands the focus back to its button.
 */

/** A button and the panel it opens, drawn in `look`. */
function Hung({ look, label }: { look: PopoverPanelLook; label: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const menu = look === POPOVER_PANEL_LOOK.MENU;
  return (
    <div className="catalog-anchor" ref={root}>
      <Button
        ref={trigger}
        variant={BUTTON_VARIANT.OUTLINE}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(!open)}
      >
        {label}
      </Button>
      {open && (
        <AnchoredPopover align={menu ? POPOVER_ALIGN.END : POPOVER_ALIGN.START}>
          <PopoverPanel
            id={panelId}
            title={label}
            look={look}
            closeLabel={menu ? undefined : "Close"}
            initialFocus={menu ? field : undefined}
            onDismiss={close}
            onLeave={(left) => {
              if (!(left instanceof Node && root.current?.contains(left))) setOpen(false);
            }}
          >
            {menu ? (
              <SearchField
                ref={field}
                label="Search servers"
                placeholder="Search servers"
                value={query}
                onChange={setQuery}
              />
            ) : (
              <>
                <Text>62% of the context window is in use.</Text>
                <Text tone={TEXT_TONE.MUTED}>As of the agent's last step.</Text>
              </>
            )}
          </PopoverPanel>
        </AnchoredPopover>
      )}
    </div>
  );
}

function PopoverPanelsExample(): React.JSX.Element {
  return (
    <CatalogSection id="popover-panel-looks" title="A card and a menu">
      <div className="catalog-popover-stage">
        <Inline gap={GAP.CONTROL} justify="between">
          <Hung look={POPOVER_PANEL_LOOK.CARD} label="Context usage" />
          <Hung look={POPOVER_PANEL_LOOK.MENU} label="MCP servers" />
        </Inline>
      </div>
    </CatalogSection>
  );
}

export const POPOVER_PANELS_EXAMPLE: Example = {
  id: "popover-panels",
  title: "Popover panels",
  Render: PopoverPanelsExample,
};
