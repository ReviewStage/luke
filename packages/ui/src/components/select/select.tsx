import { CHIP_LOOK, CHIP_WIDTH, Chip, ChipName } from "../chip/chip.js";
import { dropBelowStart, MENU_ALIGN, Menu, useMenu } from "../menu/menu.js";

/**
 * select.tsx -- the one pop-up: a field naming the value chosen now, which drops the shared menu of the values it may take.
 *
 * It is a pop-up button, as macOS draws one: a field chip with the chosen
 * value's words and a chevron, and under it `Menu`, the window's own menu,
 * every value an item and the chosen one checked. The menu opens on the
 * chosen value, so the arrows go on from where the choice stands, and
 * behaves as every other menu does: a value that does not apply now is
 * dimmed and passed over, a choice closes it with focus back on the field,
 * and Escape, Tab, or a press elsewhere closes it choosing nothing.
 *
 * It hangs from a point under the field rather than from its box (it is
 * `Menu`, not `AnchoredPopover`), so it is drawn over the window and never
 * cut off by the card or the scroller the field stands in, and stands over a
 * modal it was opened from. A list long enough to want a search is the
 * app's searchable menu, not this. What finds the field for an app (the
 * desktop's settings search) is the app's: it hands the field the `data-`
 * attributes its search lands on.
 */

/** Which of the field's edges the menu hangs from: its leading edge, or its trailing one, as at a settings row's end. */
export const SELECT_ALIGN = MENU_ALIGN;

export type SelectAlign = (typeof SELECT_ALIGN)[keyof typeof SELECT_ALIGN];

/**
 * How wide the field stands: as wide as its value's words, or the field
 * column a settings row's pop-ups share, so a card of them reads as one
 * aligned column and a change of value cannot re-shape its row.
 */
export const SELECT_WIDTH = {
  FIT: "fit",
  FIELD: "field",
} as const;

export type SelectWidth = (typeof SELECT_WIDTH)[keyof typeof SELECT_WIDTH];

/** The chip's width for each of the field's. */
const CHIP_WIDTH_OF = {
  [SELECT_WIDTH.FIT]: CHIP_WIDTH.AUTO,
  [SELECT_WIDTH.FIELD]: CHIP_WIDTH.FIELD,
} as const;

/** One value the field may take: the value, its words, and a glyph where values carry one. */
export interface SelectOption<Value extends string> {
  value: Value;
  label: string;
  icon?: React.JSX.Element;
  /** Drawn dimmed and passed over: the value cannot be chosen now. */
  disabled?: boolean;
}

/** The attributes an app hands the field for finding it, its `data-` attributes alone. */
type AppAttributes = { [attribute: `data-${string}`]: string | undefined };

/** The field over `options`, naming `value`. */
export function Select<Value extends string>(
  props: {
    /** The field's name for a reader, which a sighted one has from the row's own label. */
    label: string;
    options: readonly SelectOption<Value>[];
    value: Value;
    onChange: (value: Value) => void;
    /** The id of the why drawn beside it, which describes the field. */
    describedBy?: string | undefined;
    /** Whether the field's last change was refused, as its row says under it. */
    "aria-invalid"?: true | undefined;
    disabled?: boolean | undefined;
    /** The field's edge the menu hangs from; the leading one where none is named. */
    align?: SelectAlign | undefined;
    /** How wide the field stands; its value's own width where none is named. */
    width?: SelectWidth | undefined;
  } & AppAttributes,
): React.JSX.Element {
  const {
    label,
    options,
    value,
    onChange,
    describedBy,
    "aria-invalid": invalid,
    disabled: unavailable = false,
    align = SELECT_ALIGN.START,
    width = SELECT_WIDTH.FIT,
    ...appAttributes
  } = props;
  // Note that a field with no value it could change to is unavailable, because
  // its menu would hold nothing to take the keyboard, and so nothing to hear
  // the Escape or Tab that closes it.
  const disabled = unavailable || !options.some((option) => option.disabled !== true);
  // A field that cannot be used now does not leave its menu standing.
  const menu = useMenu(!disabled);
  const chosen = options.find((option) => option.value === value);
  const words = chosen?.label ?? value;
  return (
    <>
      {/* Note that a menu's trigger hangs it from the trailing edge unless handed another place. */}
      <Chip
        {...appAttributes}
        {...menu.trigger(align === SELECT_ALIGN.START ? dropBelowStart : undefined)}
        width={CHIP_WIDTH_OF[width]}
        look={CHIP_LOOK.FIELD}
        chevron
        aria-label={`${label}: ${words}`}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        disabled={disabled}
      >
        {chosen?.icon}
        <ChipName>{words}</ChipName>
      </Chip>
      {menu.drawn === undefined ? null : (
        <Menu
          label={label}
          menu={menu.drawn}
          openOnChecked
          groups={[
            options.map(({ value: each, ...item }) => ({
              ...item,
              checked: each === value,
              onSelect: () => {
                if (each !== value) onChange(each);
              },
            })),
          ]}
          onClose={menu.close}
        />
      )}
    </>
  );
}
