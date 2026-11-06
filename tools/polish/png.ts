import { PNG } from "pngjs";

export interface Rgb {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

const RGB_COLOR_TYPE = 2;

export function flattenPng(png: Buffer, ground: Rgb): Buffer {
  return PNG.sync.write(PNG.sync.read(png), { colorType: RGB_COLOR_TYPE, bgColor: { ...ground } });
}
