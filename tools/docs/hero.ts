/**
 * The README's hero: Claude Code in its fullscreen layout, drawn as an animated SVG. Beside the conversation the pane
 * docks the session's tasks in its sections: Working on, Up next, Waiting (the session's own waiting task), Asked of
 * others (the one it asked of another session) and Done today. A task is its status mark, its id and its title over a dim line of plain
 * words: its priority, its due day, since when it has stood at its status, what it waits on or comes after, and `new`.
 * A task done today is one dim line with the time it closed. Then the switch flips the pane to the files changed in the
 * session's repo, and back. One 14 s CSS loop and no script, so GitHub shows it in an <img>. With motion turned off it
 * is a still of the tasks. The window is dark in either theme, as a terminal is; the caption under it follows the
 * reader's theme.
 *
 * The rows follow the pane's own formats (hooks/rows.ts, hooks/meta.ts, hooks/changes-rows.ts). A task's parts sit on
 * the pane's column grid, so its meta line starts under its title in any monospace font. The status marks are drawn
 * as shapes, so no font has to carry them.
 */
import { escapeXml, MONO_FONTS, renderSvg } from './svg.ts';
import { themeStyle } from './theme.ts';
import { Timeline, type Clock } from './timeline.ts';

const WIDTH = 960;
const HEIGHT = 476;
const WINDOW_HEIGHT = 420;

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

/** What every task in the list has: its id, its title and its priority, and for some a due day or another owner. */
interface TaskBase {
  readonly id: string;
  readonly title: string;
  readonly priority: string;
  /** Its due day, as the meta line words it: `Thu 10-22`. */
  readonly due?: string;
  /** The area that owns it, when the session asked it of another session: the meta line opens `api's`. */
  readonly owner?: string;
}

/**
 * A task in the list, by its status. An open one may come after a task not finished yet, and is `new` while its owner
 * has not touched it. One in progress or waiting says since when (a time today, UTC); a waiting one says why it waits,
 * in teamrig's words (`on T13`).
 */
export type PaneTask =
  | (TaskBase & { readonly status: 'open'; readonly after?: string; readonly isNew?: boolean })
  | (TaskBase & { readonly status: 'in-progress'; readonly since: string })
  | (TaskBase & { readonly status: 'waiting'; readonly since: string; readonly waits: string });

/** A task done today: its id, its title and the time it closed (today, UTC). */
export interface DoneTask {
  readonly id: string;
  readonly title: string;
  readonly at: string;
}

export type Status = PaneTask['status'] | 'done';

/** The status colours the pane gives a task's mark (an open task's keeps the text colour). */
export const STATUS_COLOR: Readonly<Record<Status, string>> = { open: C.fg, 'in-progress': C.amber, waiting: C.red, done: C.green };

/** A section of the list: its name, drawn bold over its tasks. */
export interface Section {
  readonly name: string;
  readonly tasks: readonly PaneTask[];
}

/** The session's area, which its tab names; the pane's header leaves the session's own area unnamed. */
export const AREA = 'web';
/**
 * The session's sections, in the pane's order. Verifying, which would lead them with its heading in green, has no task
 * here, and the pane draws an empty section not at all. Waiting holds the session's own waiting task, Asked of others
 * the one it asked of api.
 */
export const SECTIONS: readonly Section[] = [
  { name: 'Working on', tasks: [{ id: 'T12', status: 'in-progress', priority: 'p1', title: 'Signup form', since: '11:55' }] },
  { name: 'Up next', tasks: [{ id: 'T14', status: 'open', priority: 'p2', title: 'Form tests', after: 'T12', isNew: true }] },
  { name: 'Waiting', tasks: [{ id: 'T9', status: 'waiting', priority: 'p2', title: 'Email check', since: '10:20', waits: 'on T13' }] },
  { name: 'Asked of others', tasks: [{ id: 'T13', status: 'open', priority: 'p2', title: 'Mail key', owner: 'api', due: 'Thu 10-22' }] },
];
export const DONE_TODAY: readonly DoneTask[] = [{ id: 'T11', title: 'Signup API', at: '09:40' }];

/** Where a file's change is, which colours its word as the pane does: staged green, in the work tree yellow, a new file dim. */
export type ChangeTone = 'staged' | 'tree' | 'new';
/**
 * The Changes view: the session's repo and its branch, then for each changed file what git's code says in words, its
 * path, its lines and what the pane adds after them; each row fits the pane's width, as the pane wraps a longer one.
 */
export const REPO = { name: 'web', branch: 'signup' } as const;
export const CHANGED: readonly { readonly word: string; readonly tone: ChangeTone; readonly path: string; readonly added: number; readonly removed: number; readonly after: string | null }[] = [
  { word: 'added', tone: 'staged', path: 'src/signup.ts', added: 42, removed: 0, after: 'staged' },
  { word: 'changed', tone: 'tree', path: 'src/routes.ts', added: 18, removed: 3, after: null },
  { word: 'new', tone: 'new', path: 'signup.md', added: 9, removed: 0, after: 'not in git yet' },
];
/** The cells a file's row gives its word, so the paths line up (hooks/changes-rows.ts CHANGE_COLUMNS). */
export const CHANGE_COLUMNS = 9;
/** The dim line over the files (hooks/changes-rows.ts DIFF_HINT). */
export const DIFF_HINT = 'click a file for its diff';

export const CAPTIONS = { tasks: "Your tasks: what's next, what's waiting, what's done", changes: 'One press on Changes: the files changed in your repo' } as const;

/** The monospace advance of the pane's 14px text: a column's width, which measured lines are forced to with textLength. */
export const PANE_CHAR = 8.4;
/** Where the pane's body starts, its first column. */
export const PANE_X = 604;
const RULE_END = 924;
/** The body's width in columns, to where its rules end: every row of the list fits in it, so none would wrap in the pane. */
export const PANE_COLUMNS = Math.floor((RULE_END - PANE_X) / PANE_CHAR);
/** Before a task's id: its status mark and a space. */
const MARK_COLUMNS = 2;
/** Between a task's id and its title (rows.ts TITLE_GAP). */
const TITLE_GAP = 2;
/** The baseline of a view's header, the Tasks view's and the Changes view's alike. */
const HEADER_Y = 128;
/** The Changes view's rows, from baseline to baseline. */
const ROW = 26;
/** The Tasks view's rows, from baseline to baseline: one line of a task, such as its title to its meta line. */
const LINE = 16;
/**
 * The blank row the pane leaves between two blocks (a header, a heading, a task), drawn this many pixels high, and
 * twice that above a section's heading, where the pane leaves a second one: so all the sections fit the window.
 */
const BLANK = 2;

interface Span {
  readonly text: string;
  readonly color: string;
  readonly bold?: boolean;
}

interface LineOptions {
  /** Forces the line to PANE_CHAR a character, so a rule can start where it ends. */
  readonly measured?: boolean;
  /** `middle` centres the line on x (a button's label); `end` ends it at x (the time a task closed, at the body's right edge). */
  readonly anchor?: 'middle' | 'end';
}

const span = (text: string, color: string, extra: Omit<Span, 'text' | 'color'> = {}): Span => ({ text, color, ...extra });

/** Column `n` of the pane's body: where a part of a row starts, on the grid the terminal draws it on. */
const column = (n: number): number => PANE_X + n * PANE_CHAR;

/** The column a task's title starts at, and its meta line under it: past its status mark, its id and a gap. */
const titleColumn = (id: string): number => MARK_COLUMNS + id.length + TITLE_GAP;

/**
 * The meta line's parts, in meta.ts's order: whose it is when another area owns it, its priority, its due day, since
 * when it has stood at its status (red while it waits, with why), the task it comes after, and `new` in the blue the
 * pane gives a suggestion. Dim, as rows.ts draws a part with no colour of its own.
 */
function metaParts(task: PaneTask): Span[] {
  return [
    ...(task.owner === undefined ? [] : [span(`${task.owner}'s`, C.muted)]),
    span(task.priority, C.muted),
    ...(task.due === undefined ? [] : [span(`due ${task.due}`, C.muted)]),
    ...statusParts(task),
  ];
}

/** The meta line's parts that depend on a task's status. */
function statusParts(task: PaneTask): Span[] {
  switch (task.status) {
    case 'open':
      return [...(task.after === undefined ? [] : [span(`after ${task.after}`, C.muted)]), ...(task.isNew === true ? [span('new', C.blue)] : [])];
    case 'in-progress':
      return [span(`in progress since ${task.since}`, C.muted)];
    case 'waiting':
      return [span(`waiting since ${task.since}: ${task.waits}`, C.red)];
  }
}

/** A task for the text alternative: `T12 Signup form (p1, in progress since 11:55)`. */
const told = (task: PaneTask): string => `${task.id} ${task.title} (${metaParts(task).map((part) => part.text).join(', ')})`;

const STORY =
  `Claude Code in its fullscreen layout. Beside the conversation, teamrig-pane docks the session's tasks in sections, ` +
  `each task over a dim line of plain words. ` +
  SECTIONS.map(({ name, tasks }) => `${name}: ${tasks.map(told).join('; ')}. `).join('') +
  `Done today: ${DONE_TODAY.map((task) => `${task.id} ${task.title}, done at ${task.at}`).join('; ')}. ` +
  `One press on Changes flips the pane to the ${CHANGED.length} files changed in the session's repo, and back.`;

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

/** A status mark, centred on its row's first column: a ring, a ring half filled, a square or a tick. */
function glyph(status: Status, y: number): string {
  const color = STATUS_COLOR[status];
  const shape = {
    open: `<circle r="4.5" fill="none" stroke="${color}" stroke-width="1.5"/>`,
    'in-progress': `<circle r="4.5" fill="none" stroke="${color}" stroke-width="1.5"/><path d="M0 -4.5a4.5 4.5 0 0 0 0 9z" fill="${color}"/>`,
    waiting: `<rect x="-4.5" y="-4.5" width="9" height="9" fill="${color}"/>`,
    done: `<path d="M-4.5 0l3 3.2l6-6.7" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  }[status];
  return `<g data-glyph="${status}" transform="translate(${column(0) + PANE_CHAR / 2} ${y - 5})">${shape}</g>`;
}

/**
 * `◐ T12  Signup form`, the id bold and the mark in its status colour, over the dim meta line `p1 · in progress since
 * 11:55` that starts under the title, its parts between dim dots: a task as rows.ts taskBlock draws it.
 */
function taskRows(task: PaneTask, y: number): string[] {
  const at = column(titleColumn(task.id));
  const meta = metaParts(task).flatMap((part, i) => (i === 0 ? [part] : [span(' · ', C.muted), part]));
  return [
    glyph(task.status, y),
    line(column(MARK_COLUMNS), y, 'pane', [span(task.id, C.fg, { bold: true })]),
    line(at, y, 'pane', [span(task.title, C.fg)]),
    line(at, y + LINE, 'pane', meta),
  ];
}

/** `✓ T11  Signup API`, dim but for its green tick, and the time it closed dim at the right edge: rows.ts doneBlock. */
function doneRow(task: DoneTask, y: number): string[] {
  return [
    glyph('done', y),
    line(column(MARK_COLUMNS), y, 'pane', [span(task.id, C.muted)]),
    line(column(titleColumn(task.id)), y, 'pane', [span(task.title, C.muted)]),
    line(column(PANE_COLUMNS), y, 'pane', [span(task.at, C.muted)], { anchor: 'end' }),
  ];
}

/** `Working on (1)`: a section's name in bold and how many tasks it holds, dim, as rows.ts sectionHeading draws it. */
function sectionHeading(name: string, count: number, y: number): string {
  return line(PANE_X, y, 'pane', [span(name, C.fg, { bold: true }), span(` (${count})`, C.muted)]);
}

/** The switch that leads the pane: Tasks and `Changes n`, the shown view's button filled. */
function switchRow(shown: 'tasks' | 'changes'): string[] {
  const buttons = [
    { view: 'tasks', label: 'Tasks', x: PANE_X, width: 58 },
    { view: 'changes', label: `Changes ${CHANGED.length}`, x: PANE_X + 66, width: 96 },
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

/**
 * The pane's Tasks view: the header, which counts the session's own active tasks and names no area, then each
 * section's heading over its tasks, Done today last.
 */
function tasksView(): string[] {
  const active = SECTIONS.flatMap((section) => section.tasks).filter((task) => task.owner === undefined).length;
  const out = [...switchRow('tasks'), ...ruled(PANE_X, HEADER_Y, [span(`${active} active`, C.muted)])];
  let y = HEADER_Y;
  const heading = (name: string, count: number): void => {
    y += LINE + 2 * BLANK;
    out.push(sectionHeading(name, count, y));
  };
  for (const { name, tasks } of SECTIONS) {
    heading(name, tasks.length);
    for (const task of tasks) {
      y += LINE + BLANK;
      out.push(...taskRows(task, y));
      y += LINE;
    }
  }
  heading('Done today', DONE_TODAY.length);
  for (const task of DONE_TODAY) {
    y += LINE + BLANK;
    out.push(...doneRow(task, y));
  }
  return out;
}

/** The colour of a file's word, as the pane colours it. */
const TONE_COLOUR: Readonly<Record<ChangeTone, string>> = { staged: C.green, tree: C.amber, new: C.muted };

/** The pane's Changes view, drawn opaque over the tasks: the repo's header, the hint, then each file's word, path, lines and what follows them. */
function changesView(): string[] {
  const out = [
    `<rect x="586" y="62" width="356" height="340" fill="${C.panel}"/>`,
    ...switchRow('changes'),
    ...ruled(PANE_X, HEADER_Y, [span(REPO.name, C.fg, { bold: true }), span(` · branch ${REPO.branch}`, C.muted), span(` · ${CHANGED.length} files`, C.muted)]),
    line(PANE_X, 160, 'pane', [span(DIFF_HINT, C.muted)]),
  ];
  CHANGED.forEach(({ word, tone, path, added, removed, after }, i) => {
    const y = 160 + (i + 1) * ROW;
    out.push(line(PANE_X, y, 'pane', [span(word, TONE_COLOUR[tone])]));
    const lines = [...(added > 0 ? [span(` +${added}`, C.green)] : []), ...(removed > 0 ? [span(` -${removed}`, C.red)] : [])];
    const said = after === null ? [] : [span(` (${after})`, C.muted)];
    out.push(line(column(CHANGE_COLUMNS), y, 'pane', [span(path, C.fg), ...lines, ...said]));
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
    line(28, 236, 'line', [span('T9 waits on the mail key; api has T13 for it.', C.fg)]),
    `<rect x="28.5" y="358.5" width="531" height="45" rx="9" fill="${C.bg}" stroke="${C.border}"/>`,
    line(44, 387, 'line', [span('>', C.muted)]),
    `<rect x="62" y="372" width="8" height="18" fill="${C.fg}"/>`,
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
    `<rect x="584.5" y="60.5" width="359" height="343" rx="10" fill="${C.panel}" stroke="${C.border}"/>`,
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
    `<text x="${WIDTH / 2}" y="458" text-anchor="middle" class="cap ${t.show(from, to === undefined ? {} : { to })}" data-part="caption">${escapeXml(words)}</text>`;
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
