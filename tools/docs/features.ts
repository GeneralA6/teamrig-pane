/**
 * The README's features picture: six cards in rows of three, one thing the pane does for you each. Every card must
 * stay true to the plugin: a claim its code does not back is a bug. It follows the reader's light or dark colour
 * scheme and does not move.
 */
import { icon, type Card } from './icons.ts';
import { escapeXml, renderSvg } from './svg.ts';
import { themeStyle } from './theme.ts';

const WIDTH = 960;
const CARD_WIDTH = 304;
const CARD_HEIGHT = 196;
const GAP = 24;
const PER_ROW = 3;

export const FEATURES: readonly Card[] = [
  { icon: 'dock', title: 'Your tasks, always in view', lines: ['Docked beside the conversation, in', 'plan order, updated as they change.'] },
  { icon: 'team', title: 'The whole team at a glance', lines: ["Every owner's tasks in one view, with", 'how many are active or waiting.'] },
  { icon: 'flag', title: 'What needs you stands out', lines: ['Waiting, overdue, new and not picked', 'up are marked; waiting ones say why.'] },
  { icon: 'details', title: 'Details on a click', lines: ['The ask in its own words, who asked', 'and when, and the latest status note.'] },
  { icon: 'changes', title: 'Changes, one press away', lines: ['Each changed file and its lines, in', 'every repo the session works in.'] },
  { icon: 'gauge', title: 'Fast, and costs no tokens', lines: ['It reads files, never the model, and', 'only when they change.'] },
];

/** The picture's height: its rows of cards, with a gap between rows. */
export const FEATURES_HEIGHT = Math.ceil(FEATURES.length / PER_ROW) * (CARD_HEIGHT + GAP) - GAP;

/** One card: its tile, its icon on a purple chip, its title and its lines. */
function card(feature: Card, i: number): string[] {
  const x = (i % PER_ROW) * (CARD_WIDTH + GAP);
  const y = Math.floor(i / PER_ROW) * (CARD_HEIGHT + GAP);
  return [
    `<rect x="${x + 0.5}" y="${y + 0.5}" width="${CARD_WIDTH - 1}" height="${CARD_HEIGHT - 1}" rx="14" class="card"/>`,
    `<rect x="${x + 24}" y="${y + 24}" width="48" height="48" rx="12" class="chip"/>`,
    icon(feature.icon, x + 34, y + 34, 28, 'icon'),
    `<text x="${x + 24}" y="${y + 114}" class="cardtitle">${escapeXml(feature.title)}</text>`,
    ...feature.lines.map((line, j) => `<text x="${x + 24}" y="${y + 143 + j * 21}" class="sub">${escapeXml(line)}</text>`),
  ];
}

/** The picture as an SVG file. */
export function renderFeatures(): string {
  return renderSvg({
    width: WIDTH,
    height: FEATURES_HEIGHT,
    label: 'What teamrig-pane does for you: ' + FEATURES.map((feature) => `${feature.title}. ${feature.lines.join(' ')}`).join(' '),
    style: [
      ...themeStyle(),
      '.cardtitle{font-size:18px;font-weight:700}.sub{font-size:14.5px;fill:var(--muted)}',
      '.card{fill:var(--tile);stroke:var(--line)}.chip{fill:var(--purple);fill-opacity:.12}',
      '.icon{fill:none;stroke:var(--purple);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}',
    ],
    body: FEATURES.flatMap(card),
  });
}
