import type { Meta, Page } from "../types.js";

export type RunScope = { partial: false } | { partial: true; reason: string };

// a page as known before its images are placed, which depends on where the page goes
export type PageInfo<M = Meta> = Omit<Page<M>, "blocks">;

export interface GuideOutput<M = Meta> {
  path(page: PageInfo<M>): string;
  render(page: Page<M>): string;
}

export interface Manifest {
  schemaVersion: 1;
  pages: string[];
  shots: string[];
}

export type Op =
  | { op: "write"; path: string; data: string | Buffer }
  | { op: "delete"; path: string };
