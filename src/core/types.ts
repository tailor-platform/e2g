import type { Meta, Page } from "../types.js";

export type RunScope = { partial: false } | { partial: true; reason: string };

export interface GuideOutput<M = Meta> {
  path(page: Page<M>): string;
  render(page: Page<M>, ctx: { image(shot: { name: string }): string }): string;
}

export interface Manifest {
  schemaVersion: 1;
  pages: string[];
  shots: string[];
}

export type Op =
  | { op: "write"; path: string; data: string | Buffer }
  | { op: "delete"; path: string };
