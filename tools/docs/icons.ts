/**
 * Line icons on a 24-unit grid, drawn with no colour of their own: the class the placing picture gives them sets the
 * stroke, so one icon reads in light and dark. Each heads a card in the README's features picture.
 */

export const ICON_NAMES = ['dock', 'team', 'flag', 'details', 'changes', 'gauge'] as const;
export type IconName = (typeof ICON_NAMES)[number];

/** The grid each icon is drawn on. */
export const ICON_GRID = 24;

const ICONS: Readonly<Record<IconName, string>> = {
  /** A window with a panel docked on its right: your tasks beside the conversation. */
  dock: '<rect x="2.5" y="4" width="19" height="16" rx="2"/><path d="M14.5 4v16M17 8.5h2M17 12h2M17 15.5h2"/>',
  /** One node over three: the whole team. */
  team: '<circle cx="12" cy="5" r="2.6"/><circle cx="4.5" cy="19" r="2.2"/><circle cx="12" cy="19" r="2.2"/><circle cx="19.5" cy="19" r="2.2"/><path d="M12 7.6V16.8M10.6 7.2 5.6 17M13.4 7.2l5 9.8"/>',
  /** A flag on its pole: what needs you. */
  flag: '<path d="M5 21.5V3.5"/><path d="M5 4.5h12.5l-2.5 4.25 2.5 4.25H5"/>',
  /** A magnifying glass: a task's details. */
  details: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
  /** A page with a plus over a minus: the files changed. */
  changes: '<path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z"/><path d="M14 2.5V8h5.5"/><path d="M9 12.5h6M12 9.5v6M9 18h6"/>',
  /** A gauge: fast, and no tokens spent. */
  gauge: '<path d="M3.2 17.5a9 9 0 1 1 17.6 0"/><path d="m12 14.5 4.2-4.7"/><circle cx="12" cy="14.5" r="1.7"/><path d="M7 20.5h10"/>',
};

/** A card in a picture: its icon, its title and the short lines under it. */
export interface Card {
  readonly icon: IconName;
  readonly title: string;
  readonly lines: readonly string[];
}

/** The icon with its top-left corner at (x, y), scaled to `size` pixels square, in the class `cls` that colours it. */
export function icon(name: IconName, x: number, y: number, size: number, cls: string): string {
  return `<g transform="translate(${x} ${y}) scale(${size / ICON_GRID})" class="${cls}">${ICONS[name]}</g>`;
}
