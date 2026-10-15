import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderFeatures } from './features.ts';
import { renderHero } from './hero.ts';

/**
 * The README's pictures, drawn in code: the hero and the features cards, in the README's order. A change to a
 * drawing changes its picture, and `images-cli.ts --check` fails until it is redrawn.
 */

export const IMAGES_DIR = 'docs/images';

export interface Picture {
  /** The file name under IMAGES_DIR. */
  readonly file: string;
  readonly svg: string;
}

export function drawPictures(): Picture[] {
  return [
    { file: 'hero.svg', svg: renderHero() },
    { file: 'features.svg', svg: renderFeatures() },
  ];
}

const pathOf = (root: string, picture: Picture): string => join(root, IMAGES_DIR, picture.file);
const readOrNull = (path: string): string | null => (existsSync(path) ? readFileSync(path, 'utf8') : null);

/** The pictures whose file under `root` is missing or differs from a fresh drawing, as repo paths. */
export function stalePictures(root: string, pictures: readonly Picture[]): string[] {
  return pictures.filter((picture) => readOrNull(pathOf(root, picture)) !== picture.svg).map((picture) => `${IMAGES_DIR}/${picture.file}`);
}

/** Writes every picture under `root`; returns the repo paths written. */
export function writePictures(root: string, pictures: readonly Picture[]): string[] {
  mkdirSync(join(root, IMAGES_DIR), { recursive: true });
  for (const picture of pictures) writeFileSync(pathOf(root, picture), picture.svg);
  return pictures.map((picture) => `${IMAGES_DIR}/${picture.file}`);
}
