export interface Frame {
  readonly width: number;
  readonly height: number;
  readonly zoom: number;
  readonly phone: boolean;
}

export function sizedScript(frame: Frame): string {
  const width = frame.width / frame.zoom;
  const height = frame.height / frame.zoom;
  return `Math.abs(innerWidth - ${width}) < 1 && Math.abs(innerHeight - ${height}) < 1`;
}
