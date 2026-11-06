import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { cn } from "../cn.js";
import { ChevronRightIcon } from "../face/glyphs.js";

export const DROPDOWN_MENU_ITEM =
  "group/menu-item relative flex h-menu-row w-full flex-none cursor-default items-center gap-icon-gap rounded-menu-row border-0 bg-transparent px-row-inset py-0 text-left font-sans text-body leading-[normal] font-text whitespace-nowrap text-foreground select-none data-[variant=destructive]:text-danger data-[detail=true]:h-auto data-[detail=true]:min-h-menu-row data-[detail=true]:py-ui-4";

export const DROPDOWN_MENU_ITEM_LIT =
  "hover:not-disabled:not-aria-disabled:bg-secondary focus-visible:not-disabled:not-aria-disabled:bg-secondary data-popup-open:not-disabled:not-aria-disabled:bg-secondary data-[variant=destructive]:hover:not-disabled:bg-destructive/16 data-[variant=destructive]:focus-visible:not-disabled:bg-destructive/16";

export const DROPDOWN_MENU_SURFACE =
  "flex flex-col rounded-menu border border-border-strong bg-background p-menu-inset text-foreground shadow-menu animate-menu-in data-[leaving=true]:pointer-events-none data-[leaving=true]:animate-menu-leave data-[leaving=true]:transition-none data-ending-style:pointer-events-none data-ending-style:animate-menu-leave data-ending-style:transition-none data-[placed=false]:invisible";

const DROPDOWN_MENU_POPUP = "max-h-menu-max max-w-menu-most min-w-menu-least overflow-hidden";

function DropdownMenu({ ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

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
