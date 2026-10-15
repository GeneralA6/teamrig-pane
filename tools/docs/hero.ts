/**
 * The README's hero: Claude Code in its fullscreen layout, drawn as an animated SVG. Beside the conversation the pane
 * docks the session's tasks, each with its status, priority and due date, what blocks one, what the session asked of
 * others and what it finished today. Then the switch flips the pane to the files changed in the session's repo, and
 * back. One 14 s CSS loop and no script, so GitHub shows it in an <img>. With motion turned off it is a still of the
 * tasks. The window is dark in either theme, as a terminal is; the caption under it follows the reader's theme.
 *
 * The rows follow the pane's own formats (hooks/rows.ts, hooks/changes-rows.ts). Its status glyphs, the row marker
 * and the blocked note's arrow are drawn as shapes, so no font has to carry them.
 */
import { escapeXml, MONO_FONTS, renderSvg } from './svg.ts';
import { themeStyle } from './theme.ts';
import { Timeline, type Clock } from './timeline.ts';

const WIDTH = 960;
const HEIGHT = 456;
const WINDOW_HEIGHT = 400;

/** 14 s a loop; the picture fades out at 13.4 s; the still shows 12.6 s, when the tasks are back. */
export const HERO_CLOCK: Clock = { loop: 14, end: 13.4, rest: 12.6 };

/** When each part shows, in seconds: the window, the pane's tasks, then the Changes view from `changes` to `back`. */
export const HERO_STEPS = { window: 0.3, tasks: 1.2, changes: 6.9, back: 10.8 } as const;

/** GitHub's dark palette: the window is dark in either theme, as a terminal is. */
export const PALETTE = {
  bg: '#0d1117',
  bar: '#161b22',
  panel: '#11161d',
  border: '#30363d',
  fg: '#e6edf3',
  muted: '#8b949e',
  faint: '#6e7681',
  lead: '#a371f7',
  amber: '#d29922',
  green: '#3fb950',
  red: '#f85149',
  blue: '#79c0ff',
} as const;
const C = PALETTE;

export type Status = 'open' | 'in-progress' | 'blocked' | 'done';

/** The status colours the pane gives a task's glyph and id (an open task keeps the text colour). */
export const STATUS_COLOR: Readonly<Record<Status, string>> = { open: C.fg, 'in-progress': C.amber, blocked: C.red, done: C.green };

export interface PaneTask {
  readonly id: string;
  readonly status: Status;
  readonly priority: string;
  readonly title: string;
  readonly due?: string;
  /** Added since the session last looked: the pane flags it NEW. */
  readonly isNew?: boolean;
  /** For a task asked of others: who owns it. */
  readonly owner?: string;
  /** A blocked task's note, drawn under it. */
  readonly note?: string;
}

/** The session's area, the inbox lines it has not read, and its tasks: active in plan order, asked of others, finished today. */
export const AREA = 'web';
export const UNREAD = 1;
export const ACTIVE: readonly PaneTask[] = [
  { id: 'T12', status: 'in-progress', priority: 'p1', due: '10-16', title: 'Signup form' },
  { id: 'T14', status: 'open', priority: 'p2', isNew: true, title: 'Form tests' },
  { id: 'T15', status: 'blocked', priority: 'p2', title: 'Email check', note: 'waits on the mail key' },
];
export const ASKED: readonly PaneTask[] = [{ id: 'T13', status: 'open', priority: 'p2', owner: 'api', title: 'Mail key' }];
export const FINISHED: readonly PaneTask[] = [{ id: 'T11', status: 'done', priority: 'p1', title: 'Signup API' }];

/** The Changes view: the session's repo, its branch, and git's two-letter code and path for each changed file. */
export const REPO = { name: 'web', branch: 'signup' } as const;
export const CHANGED: readonly { readonly code: string; readonly path: string }[] = [
  { code: 'A ', path: 'src/signup.test.ts' },
  { code: ' M', path: 'src/signup.ts' },
  { code: '??', path: 'docs/signup.md' },
];

export const CAPTIONS = { tasks: 'Your tasks, beside the conversation', changes: 'One press on Changes: the files changed in your repo' } as const;

const STORY =
  `Claude Code in its fullscreen layout. Beside the conversation, teamrig-pane docks the session's tasks: ` +
  `${ACTIVE.map((task) => `${task.id} ${task.title}, ${task.status.replace('-', ' ')}`).join('; ')}. ` +
  `Under them, what the session asked of others and what it finished today. ` +
  `One press on Changes flips the pane to the ${CHANGED.length} files changed in the session's repo, and back.`;

/** The monospace advance of the pane's 14px text, which measured lines are forced to with textLength. */
export const PANE_CHAR = 8.4;
const PANE_X = 604;
const GLYPH_X = 620;
const TEXT_X = 632;
const RULE_END = 924;
const ROW = 26;

interface Span {
  readonly text: string;
  readonly color: string;
  readonly bold?: boolean;
}

interface LineOptions {
  /** Forces the line to PANE_CHAR a character, so a rule can start where it ends. */
  readonly measured?: boolean;
  readonly anchor?: 'middle';
}

const span = (text: string, color: string, extra: Omit<Span, 'text' | 'color'> = {}): Span => ({ text, color, ...extra });

/** One line of window text. Every word sits in a coloured tspan, so the theme's text colour never reaches the window. */
function line(x: number, y: number, size: string, spans: readonly Span[], { measured = false, anchor }: LineOptions = {}): string {
  const chars = spans.reduce((sum, part) => sum + part.text.length, 0);
  const length = measured ? ` textLength="${(chars * PANE_CHAR).toFixed(1)}" lengthAdjust="spacingAndGlyphs"` : '';
  const anchored = anchor === undefined ? '' : ` text-anchor="${anchor}"`;
  const body = spans
    .map((part) => {
      const bold = part.bold === true ? ' font-weight="600"' : '';
      return `<tspan fill="${part.color}"${bold}>${escapeXml(part.text)}</tspan>`;
    })
    .join('');
  return `<text x="${x}" y="${y}" class="mono ${size}"${anchored}${length}>${body}</text>`;
}

/** A measured pane line followed by a rule to the body's edge, as the pane draws a header. */
function ruled(x: number, y: number, spans: readonly Span[]): string[] {
  const chars = spans.reduce((sum, part) => sum + part.text.length, 0);
  const from = x + chars * PANE_CHAR + 8;
  return [line(x, y, 'pane', spans, { measured: true }), `<path d="M${from.toFixed(1)} ${y - 4.5}H${RULE_END}" stroke="${C.border}"/>`];
}

/** A status glyph, centred on (x, y): a ring, a half-filled ring, a square or a tick. */
function glyph(status: Status, x: number, y: number, color: string): string {
  const shape = {
    open: `<circle cx="${x}" cy="${y}" r="4.5" fill="none" stroke="${color}" stroke-width="1.5"/>`,
    'in-progress': `<circle cx="${x}" cy="${y}" r="4.5" fill="none" stroke="${color}" stroke-width="1.5"/><path d="M${x} ${y - 4.5}a4.5 4.5 0 0 0 0 9z" fill="${color}"/>`,
    blocked: `<rect x="${x - 4.5}" y="${y - 4.5}" width="9" height="9" fill="${color}"/>`,
    done: `<path d="M${x - 4.5} ${y}l3 3.2l6-6.7" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  }[status];
  return `<g data-glyph="${status}">${shape}</g>`;
}

/** `▸ ◐ T12 →api p1 10-16 NEW title`, as rows.ts lays a task out; a finished task is dim throughout. */
function taskRow(task: PaneTask, y: number, finished: boolean): string[] {
  const color = finished ? C.muted : STATUS_COLOR[task.status];
  const spans = [span(task.id, color, { bold: !finished })];
  if (finished) {
    spans.push(span(` ${task.title}`, C.muted));
  } else {
    if (task.owner !== undefined) spans.push(span(` →${task.owner}`, C.blue));
    spans.push(span(` ${task.priority}${task.due === undefined ? '' : ` ${task.due}`}`, C.muted));
    if (task.isNew === true) spans.push(span(' NEW', C.blue));
    spans.push(span(` ${task.title}`, C.fg));
  }
  return [
    `<path d="M${PANE_X} ${y - 9.5}l5.5 4.5l-5.5 4.5z" fill="${C.muted}"/>`,
    glyph(task.status, GLYPH_X, y - 5, color),
    line(TEXT_X, y, 'pane', spans),
  ];
}

/** `↳ note`, under a blocked task's id, in the blocked colour. */
function noteRow(note: string, y: number): string[] {
  return [
    `<path d="M${TEXT_X + 1} ${y - 11}v6h8m-3-3l3 3l-3 3" fill="none" stroke="${C.red}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`,
    line(TEXT_X + 16, y, 'pane', [span(note, C.red)]),
  ];
}

/** `── label ───────`: a ruled heading that opens a section. */
function heading(label: string, y: number): string[] {
  return [`<path d="M${PANE_X} ${y - 4.5}h14" stroke="${C.border}"/>`, ...ruled(PANE_X + 20, y, [span(label, C.muted)])];
}

/** The switch that leads the pane: Tasks and `Changes Δn`, the shown view's button filled. */
function switchRow(shown: 'tasks' | 'changes'): string[] {
  const buttons = [
    { view: 'tasks', label: 'Tasks', x: PANE_X, width: 58 },
    { view: 'changes', label: `Changes Δ${CHANGED.length}`, x: PANE_X + 66, width: 106 },
  ] as const;
  return buttons.flatMap(({ view, label, x, width }) => {
    const primary = view === shown;
    const fill = primary ? `fill="${C.lead}" fill-opacity="0.2" stroke="${C.lead}"` : `fill="none" stroke="${C.border}"`;
    return [
      `<rect x="${x + 0.5}" y="72.5" width="${width}" height="26" rx="6" ${fill} data-button="${view}"/>`,
      line(x + width / 2 + 0.5, 90, 'btn', [span(label, primary ? C.fg : C.muted, { bold: primary })], { anchor: 'middle' }),
    ];
  });
}

/** The pane's Tasks view: the area's header, its active tasks, then the sections that have tasks. */
function tasksView(): string[] {
  const out = [
    ...switchRow('tasks'),
    ...ruled(PANE_X, 128, [
      span(AREA, C.fg, { bold: true }),
      span(` · ${ACTIVE.length} active`, C.muted),
      span(` · inbox ${UNREAD} unread`, C.amber),
    ]),
  ];
  let y = 160;
  const rows = (tasks: readonly PaneTask[], finished: boolean): void => {
    for (const task of tasks) {
      out.push(...taskRow(task, y, finished));
      if (task.note !== undefined) {
        y += 24;
        out.push(...noteRow(task.note, y));
      }
      y += ROW;
    }
  };
  const section = (label: string): void => {
    y += 8;
    out.push(...heading(label, y));
    y += ROW;
  };
  rows(ACTIVE, false);
  section(`asked of others (${ASKED.length})`);
  rows(ASKED, false);
  section('finished today');
  rows(FINISHED, true);
  return out;
}

/** The pane's Changes view, drawn opaque over the tasks: the repo's header and git's code for each file. */
function changesView(): string[] {
  const out = [
    `<rect x="586" y="62" width="356" height="320" fill="${C.panel}"/>`,
    ...switchRow('changes'),
    ...ruled(PANE_X, 128, [span(REPO.name, C.fg, { bold: true }), span(` · ${REPO.branch}`, C.muted), span(` · ${CHANGED.length} changed`, C.muted)]),
  ];
  CHANGED.forEach(({ code, path }, i) => {
    const y = 160 + i * ROW;
    const [index = ' ', tree = ' '] = code;
    if (code === '??') out.push(line(PANE_X, y, 'pane', [span('??', C.muted)]));
    if (code !== '??' && index !== ' ') out.push(line(PANE_X, y, 'pane', [span(index, C.green)]));
    if (code !== '??' && tree !== ' ') out.push(line(PANE_X + PANE_CHAR, y, 'pane', [span(tree, C.amber)]));
    out.push(line(PANE_X + 3 * PANE_CHAR, y, 'pane', [span(path, C.fg)]));
  });
  return out;
}

/** The talk beside the pane: the user's ask, the session's reply, and the input box. */
function conversation(): string[] {
  const prompt = (text: string): Span[] => [span('> ', C.muted), span(text, C.fg)];
  return [
    line(28, 84, 'line', prompt('Carry on with my tasks')),
    line(28, 122, 'line', [span('T11 is done: the signup API passes its tests.', C.fg)]),
    line(28, 146, 'line', [span('Next, T12: the signup form.', C.fg)]),
    ...[400, 350, 380].map((width, i) => `<rect x="28" y="${162 + i * 16}" width="${width}" height="8" rx="4" fill="${C.faint}" fill-opacity="0.5"/>`),
    line(28, 236, 'line', [span('T15 waits on the mail key; api has T13 for it.', C.fg)]),
    `<rect x="28.5" y="338.5" width="531" height="45" rx="9" fill="${C.bg}" stroke="${C.border}"/>`,
    line(44, 367, 'line', [span('>', C.muted)]),
    `<rect x="62" y="352" width="8" height="18" fill="${C.fg}"/>`,
  ];
}

/** The window: its title bar with the session's tab, the talk, and the docked pane. */
function claudeWindow(t: Timeline): string[] {
  return [
    `<g class="${t.show(HERO_STEPS.window, { motion: 'fade' })}" data-part="window">`,
    `<rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${WINDOW_HEIGHT - 1}" rx="12" fill="${C.bg}" stroke="${C.border}"/>`,
    `<path d="M1 13a12 12 0 0 1 12-12h${WIDTH - 26}a12 12 0 0 1 12 12v31h-${WIDTH - 2}z" fill="${C.bar}"/>`,
    `<path d="M12 44v-28a8 8 0 0 1 8-8h88a8 8 0 0 1 8 8v28z" fill="${C.bg}"/>`,
    `<circle cx="30" cy="27" r="4.5" fill="${C.lead}"/>`,
    line(42, 32, 'tab', [span(AREA, C.fg)]),
    `<g data-part="conversation">`,
    ...conversation(),
    `</g>`,
    `<g data-part="pane">`,
    `<rect x="584.5" y="60.5" width="359" height="323" rx="10" fill="${C.panel}" stroke="${C.border}"/>`,
    `<g class="${t.show(HERO_STEPS.tasks)}" data-part="tasks">`,
    ...tasksView(),
    `</g>`,
    `<g class="${t.show(HERO_STEPS.changes, { to: HERO_STEPS.back, motion: 'fade' })}" data-part="changes">`,
    ...changesView(),
    `</g>`,
    `</g>`,
    `</g>`,
  ];
}

/** The caption under the window, in the reader's theme: the tasks, the Changes view, then the tasks again. */
function captions(t: Timeline): string[] {
  const caption = (words: string, from: number, to?: number): string =>
    `<text x="${WIDTH / 2}" y="438" text-anchor="middle" class="cap ${t.show(from, to === undefined ? {} : { to })}" data-part="caption">${escapeXml(words)}</text>`;
  return [
    caption(CAPTIONS.tasks, HERO_STEPS.tasks, HERO_STEPS.changes - 0.3),
    caption(CAPTIONS.changes, HERO_STEPS.changes, HERO_STEPS.back),
    caption(CAPTIONS.tasks, HERO_STEPS.back),
  ];
}

/** The hero as an SVG file. */
export function renderHero(): string {
  const t = new Timeline(HERO_CLOCK);
  const body = [...claudeWindow(t), ...captions(t)];
  return renderSvg({
    width: WIDTH,
    height: HEIGHT,
    label: STORY,
    style: [
      ...themeStyle(),
      `.mono{font-family:${MONO_FONTS}}`,
      '.line{font-size:15px}.tab{font-size:14px}.pane{font-size:14px}.btn{font-size:13px}.cap{font-size:17px;font-weight:600}',
      t.css(),
      '@media (prefers-reduced-motion:reduce){*{animation:none!important}}',
    ],
    body,
  });
}
