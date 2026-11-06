export const SHELL_ROOM = {
  WIDE: "wide",
  NARROW: "narrow",
} as const;

export type ShellRoom = (typeof SHELL_ROOM)[keyof typeof SHELL_ROOM];

const SHELL_ROOM_NARROW = {
  ENTER: 640,
  LEAVE: 672,
} as const;

const PHONE_SCREEN_SIDE = 500;

export interface StageBox {
  readonly width: number;
  readonly screenSide: number;
  readonly coarse: boolean;
}

export function narrowStage(stage: StageBox, was: boolean): boolean {
  if (stage.width < (was ? SHELL_ROOM_NARROW.LEAVE : SHELL_ROOM_NARROW.ENTER)) return true;
  return stage.coarse && stage.screenSide > 0 && stage.screenSide < PHONE_SCREEN_SIDE;
}

export interface HiddenColumns {
  readonly list: boolean;
  readonly item: boolean;
}

export function hiddenColumns(room: ShellRoom, listed: boolean): HiddenColumns {
  const narrow = room === SHELL_ROOM.NARROW;
  return { list: narrow && !listed, item: narrow && listed };
}
