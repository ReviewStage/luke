import { Vector3 } from "three";
import { hashOf, seeded, TAU } from "./kit";
import type { District } from "./layout";
import type { Cell, Town } from "./town";

/**
 * lots.ts -- who builds where: each district's free cells handed out to the construction sites, the shipped houses, and the burnt-out shells, and the open ground round its curb once its cells run out.
 *
 * A claim is seeded by what it is for (an agent's id, a pull request's URL),
 * so the same work lands on the same lot from one update to the next, and
 * claims are made in a fixed order, the largest first, so a scrub that adds a
 * house never moves a site. A claim clears every cell its footprint covers;
 * the world folds those cells' buildings away (`town.ts`), so the new thing
 * stands where the old one stood.
 */

/** Where a claim landed: its centre on the board, and whether it took cells inside the district or spilled out past the curb. */
export interface Lot {
  readonly x: number;
  readonly z: number;
  readonly inside: boolean;
}

/** One update's claims over a town's cells. */
export class Lots {
  /** The cells cleared, by id. */
  readonly cleared = new Set<number>();
  private readonly cells = new Map<District, Cell[]>();
  private readonly outside = new Map<District, number>();
  /** Cells cut into quarters for small claims, and how many quarters of each are taken. */
  private readonly quartered = new Map<Cell, number>();

  constructor(
    town: Town,
    private readonly inBounds: (x: number, z: number) => boolean,
  ) {
    for (const cell of town.cells) {
      const list = this.cells.get(cell.district) ?? [];
      list.push(cell);
      this.cells.set(cell.district, list);
    }
  }

  /**
   * Claims ground for a footprint of `radius` in `district`, seeded by `seed`:
   * a free cell whose neighbours within the footprint are free too, clearing
   * them all, or, once none is left, a spot on the grass just past the curb.
   */
  claim(district: District, seed: string, radius: number): Lot {
    const rnd = seeded(hashOf(seed));
    const cells = this.cells.get(district) ?? [];
    const small = cells[0] !== undefined && radius <= cells[0].size * 0.3;
    if (small) {
      const quarter = this.quarter(cells);
      if (quarter !== undefined) return quarter;
    }
    const free = cells.filter((cell) => !this.cleared.has(cell.id));
    const start = Math.floor(rnd() * Math.max(1, free.length));
    for (let step = 0; step < free.length; step += 1) {
      const cell = free[(start + step) % free.length];
      if (cell === undefined) continue;
      const covered = cells.filter(
        (other) => Math.hypot(other.x - cell.x, other.z - cell.z) < radius + other.size * 0.4,
      );
      if (covered.some((other) => this.cleared.has(other.id))) continue;
      if (Math.hypot(cell.x - district.x, cell.z - district.z) + radius > district.plotRadius + 0.6)
        continue;
      for (const other of covered) this.cleared.add(other.id);
      if (small) {
        this.quartered.set(cell, 1);
        return this.quarterOf(cell, 0);
      }
      return { x: cell.x, z: cell.z, inside: true };
    }
    return this.spill(district, radius, rnd);
  }

  /** The next free quarter of a cell already cut into quarters, in the order they were cut. */
  private quarter(cells: readonly Cell[]): Lot | undefined {
    for (const cell of cells) {
      const taken = this.quartered.get(cell);
      if (taken === undefined || taken >= 4) continue;
      this.quartered.set(cell, taken + 1);
      return this.quarterOf(cell, taken);
    }
    return undefined;
  }

  /** The centre of a cell's `quarter`th quarter. */
  private quarterOf(cell: Cell, quarter: number): Lot {
    const offset = cell.size / 4;
    return {
      x: cell.x + (quarter % 2 ? offset : -offset),
      z: cell.z + (quarter < 2 ? -offset : offset),
      inside: true,
    };
  }

  /** A spot on the grass round the district's curb, the next one along that stays on the board, as a suburb grows. */
  private spill(district: District, radius: number, rnd: () => number): Lot {
    const at = new Vector3();
    for (let tries = 0; tries < 40; tries += 1) {
      const taken = this.outside.get(district) ?? 0;
      this.outside.set(district, taken + 1);
      const perRing = 12 + Math.floor(taken / 12) * 4;
      const ring = Math.floor(taken / 12);
      const angle =
        Math.PI / 2 + (taken % perRing) * (TAU / perRing) + ring * 0.3 + (rnd() - 0.5) * 0.1;
      const r = district.radius + 1.4 + radius + ring * 2.2;
      at.set(district.x + Math.cos(angle) * r, 0, district.z + Math.sin(angle) * r);
      if (this.inBounds(at.x, at.z)) break;
    }
    return { x: at.x, z: at.z, inside: false };
  }
}
