import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { cn } from "../cn.js";
import { ChevronRightIcon } from "../face/glyphs.js";

/**
 * dropdown-menu.tsx -- shadcn/ui's dropdown menu (style `base-nova`, on Base UI), vendored and drawn as Luke's menu.
 *
 * The component is shadcn's own source, kept as close to it as the window
 * allows, so a later `shadcn add dropdown-menu` reads as a small diff.
 * Luke's changes:
 *
 * - The content hangs from whatever anchor its owner hands it, a point in
 *   the window as well as a button (`anchor`), and is held inside what can
 *   be seen of the window (`collisionBoundary`, `collisionAvoidance`,
 *   `collisionPadding`), fixed to it; the positioner carries the layer it
 *   stands in (`data-layer`), over the window or over a modal it was opened
 *   from. The popup draws Luke's menu surface: the overlay ground, the
 *   strong edge, the menu's corner, shadow, and inset, a menu's width
 *   bounds, no taller than the room Base UI finds for it
 *   (`--available-height`, read by the theme's `menu-max`) and scrolling
 *   nothing itself, since `Menu` scrolls its rows inside it and fades
 *   their cut edge, and its entrance, a fade and a drop; and while its owner holds
 *   it drawn through its exit (`data-leaving`), or Base UI does as it
 *   closes (`data-ending-style`), as a submenu does when its menu closes it
 *   alone, its fade out, taking no press. None of shadcn's ring or outline utilities, because the
 *   window's own focus ring draws the keyboard's (`anti-slop/no-shadcn-focus-ring`);
 *   a row marks its focus with its fill instead, which `menu.css` says.
 * - An item is a menu row: one fixed height (or grown to hold a second
 *   line, `data-detail`), the menu row's corner and type, lit by the fill
 *   every row is lit by, red for an act that cannot be taken back
 *   (`variant="destructive"`), dimmed where it does not apply now, and
 *   lit under the pointer and the keyboard's focus as the window's rows
 *   are, rather than wherever Base UI's highlight stands. A
 *   checkbox item draws its own end rather than shadcn's absolute check, so
 *   a hint stands before it and an unchecked setting keeps its room; a
 *   submenu's trigger ends in the menu's chevron slot. A separator is a
 *   rule (`<hr>`), as the menu's always was.
 * - The parts `@luke/ui`'s `Menu` draws nothing with (trigger, group,
 *   label, radio group and item, shortcut, and the bare portal) are left
 *   out, because nothing would call them.
 *
 * `@luke/ui`'s `Menu` (`components/menu/menu.tsx`) is what an app draws;
 * this is its inside.
 */

/** A menu row's shape, as every item, checkbox item, and submenu trigger draws it, which a row standing outside any menu wears too. */
export const DROPDOWN_MENU_ITEM =
  "group/menu-item relative flex h-menu-row w-full flex-none cursor-default items-center gap-icon-gap rounded-menu-row border-0 bg-transparent px-row-inset py-0 text-left font-sans text-body leading-[normal] font-text whitespace-nowrap text-foreground select-none data-[variant=destructive]:text-danger data-[detail=true]:h-auto data-[detail=true]:min-h-menu-row data-[detail=true]:py-luke-4 disabled:opacity-disabled aria-disabled:opacity-disabled";

/**
 * A row in a menu lit by the fill every row is lit by, never ringed: under
 * the pointer, where the keyboard's focus stands, and on a submenu's item
 * while its submenu stands beside it; never where it does not apply now.
 * A phone's sheet of a menu's rows, which stand in no Base UI menu, wears it too.
 */
export const DROPDOWN_MENU_ITEM_LIT =
  "[&:is(:hover,:focus-visible,[data-popup-open]):not(:disabled,[aria-disabled=true])]:bg-secondary data-[variant=destructive]:[&:is(:hover,:focus-visible):not(:disabled)]:bg-destructive/16";

/** The surface every menu stands on, a list its owner hangs and keys itself included. */
export const DROPDOWN_MENU_SURFACE =
  "flex flex-col rounded-menu border border-border-strong bg-background p-menu-inset text-foreground shadow-menu animate-menu-in data-[leaving=true]:pointer-events-none data-[leaving=true]:animate-menu-leave data-[leaving=true]:transition-none data-ending-style:pointer-events-none data-ending-style:animate-menu-leave data-ending-style:transition-none data-[placed=false]:invisible";

/** A menu's own popup on that surface: a menu's width, and no taller than the room Base UI finds for it, its rows scrolling inside it rather than the popup itself. */
const DROPDOWN_MENU_POPUP = "max-h-menu-max max-w-menu-most min-w-menu-least overflow-hidden";

function DropdownMenu({ ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

/** Where the content hangs and what holds it, with the layer it stands in. */
type DropdownMenuPlacement = Pick<
  MenuPrimitive.Positioner.Props,
  | "align"
  | "alignOffset"
  | "side"
  | "sideOffset"
  | "anchor"
  | "collisionBoundary"
  | "collisionAvoidance"
  | "collisionPadding"
> & { layer?: string | undefined };

function DropdownMenuContent({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  anchor,
  collisionBoundary,
  collisionAvoidance,
  collisionPadding,
  layer,
  className,
  ...props
}: MenuPrimitive.Popup.Props & DropdownMenuPlacement) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="isolate z-menu data-[layer=dialog]:z-menu-over-dialog"
        data-layer={layer}
        positionMethod="fixed"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        anchor={anchor}
        collisionBoundary={collisionBoundary}
        collisionAvoidance={collisionAvoidance}
        collisionPadding={collisionPadding}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(DROPDOWN_MENU_SURFACE, DROPDOWN_MENU_POPUP, className)}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

function DropdownMenuItem({
  className,
  variant = "default",
  ...props
}: MenuPrimitive.Item.Props & {
  variant?: "default" | "destructive";
}) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={variant}
      className={cn(DROPDOWN_MENU_ITEM, DROPDOWN_MENU_ITEM_LIT, className)}
      {...props}
    />
  );
}

function DropdownMenuSub({ ...props }: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />;
}

function DropdownMenuSubTrigger({
  className,
  children,
  endClassName,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props & {
  /** The class of the chevron's slot at the row's end. */
  endClassName?: string | undefined;
}) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      className={cn(DROPDOWN_MENU_ITEM, DROPDOWN_MENU_ITEM_LIT, className)}
      {...props}
    >
      {children}
      <span className={endClassName}>
        <ChevronRightIcon />
      </span>
    </MenuPrimitive.SubmenuTrigger>
  );
}

function DropdownMenuSubContent({
  align = "start",
  alignOffset = -3,
  side = "right",
  sideOffset = 0,
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      data-slot="dropdown-menu-sub-content"
      className={className}
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      {...props}
    />
  );
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: MenuPrimitive.CheckboxItem.Props) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(DROPDOWN_MENU_ITEM, DROPDOWN_MENU_ITEM_LIT, className)}
      checked={checked}
      {...props}
    >
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

/** The rule between a menu's groups, which a phone's sheet of a menu's rows draws too. */
export const DROPDOWN_MENU_RULE = "mx-row-inset my-menu-inset h-px flex-none border-0 bg-border";

function DropdownMenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      render={<hr />}
      className={cn(DROPDOWN_MENU_RULE, className)}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
};
