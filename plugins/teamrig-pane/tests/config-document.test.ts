// The team's settings from teamrig's `config` document (hooks/config-document.ts): each config key the views read is
// taken from its served row, the rows the pane does not draw with passed over; a row marked with a problem is read
// as its default, as teamrig reads it; with no team the document names the teams to join; a document with no team
// field, team list, zone or setting list is unreadable, and so is one missing a setting the pane draws with (T4742).
import { describe, expect, test } from 'claude-code/testing'
import { configOf } from '../hooks/config-document'
import { parseDocument, type JsonRecord, type ReadDocument } from '../hooks/read-document'
import { CONTROL_SHOWN } from '../hooks/shown-text'
import type { TeamSettings } from '../types'

/** The schema type of a served value, as far as these rows go. */
function typeOf(value: unknown): string {
  return Array.isArray(value) ? 'array' : typeof value
}

/** A row as interface 1.0 serves it (teamrig src/interface/config.ts ServedSetting), every field named. */
function setting(path: string, value: unknown, over: JsonRecord = {}): JsonRecord {
  return {
    path,
    group: path.slice(0, path.indexOf('.')),
    type: typeOf(value),
    items: Array.isArray(value) ? 'number' : null,
    enum: null,
    min: null,
    max: null,
    value,
    default: value,
    isDefault: true,
    meaning: 'What the key sets.',
    editable: true,
    gatedBy: null,
    readOnly: null,
    problem: null,
    kept: null,
    ...over,
  }
}

/** Every key the pane draws with, each with a value no other holds, among keys it never asks for. */
const SERVED: readonly (readonly [string, unknown])[] = [
  ['messages.maxLines', 10],
  ['register.ownerSource', 'boss'],
  ['register.requireDecisionCard', false],
  ['register.check.notPickedUpAfterHours', 36],
  ['register.priorities', ['p0', 'p1']],
  ['focus.defaultClass', 'Improvements'],
  ['focus.roadmapClass', 'Roadmap'],
  ['focus.maintenanceClass', 'Upkeep'],
  ['focus.parkAfterDays', 9],
  ['focus.score.rankValues', [100, 80, 60]],
  ['focus.score.roadmapUnranked', 41],
  ['focus.score.maintenanceValue', 42],
  ['focus.score.maintenanceBug', 43],
  ['focus.score.maintenanceCritical', 44],
  ['focus.score.improvementsValue', 45],
  ['focus.score.overdueValue', 46],
  ['focus.score.dueSoonValue', 47],
  ['focus.score.dueSoonDays', 3],
  ['focus.score.unblocksShare', 0.25],
  ['focus.score.ownerOrderValues', [140, 120]],
  ['focus.score.defaultSizePct', 2.5],
  ['focus.score.minSizePct', 0.5],
  ['focus.expedite.critical', true],
  ['focus.expedite.ownerP1', false],
  ['roles.lead', 'lead'],
]

/** The served rows, with each of `swapped` in the place of the row of its path. */
function rows(swapped: readonly JsonRecord[] = []): JsonRecord[] {
  return SERVED.map(([path, value]) => swapped.find(row => row['path'] === path) ?? setting(path, value))
}

const SETTINGS: TeamSettings = {
  notPickedUpAfterHours: 36,
  timeZone: 'Asia/Jerusalem',
  ownerSource: 'boss',
  requireDecisionCard: false,
  focus: {
    defaultClass: 'Improvements',
    roadmapClass: 'Roadmap',
    maintenanceClass: 'Upkeep',
    parkAfterDays: 9,
    score: {
      rankValues: [100, 80, 60],
      roadmapUnranked: 41,
      maintenanceValue: 42,
      maintenanceBug: 43,
      maintenanceCritical: 44,
      improvementsValue: 45,
      overdueValue: 46,
      dueSoonValue: 47,
      dueSoonDays: 3,
      unblocksShare: 0.25,
      ownerOrderValues: [140, 120],
      defaultSizePct: 2.5,
      minSizePct: 0.5,
    },
    expedite: { critical: true, ownerP1: false },
  },
}

/** A `config` document holding `over` in place of the fields it names. */
function documentOf(over: JsonRecord = {}): ReadDocument {
  const read = parseDocument({
    interface: '1.0',
    document: 'config',
    revision: 'r4',
    problems: [],
    team: 'kit',
    teams: [],
    timeZone: 'Asia/Jerusalem',
    priorities: ['p0', 'p1'],
    settings: rows(),
    cuts: [],
    ...over,
  })
  if (read.kind !== 'document') throw new Error(`no document: ${read.kind}`)
  return read.document
}

function unreadable(why: string): unknown {
  return { kind: 'unreadable', reason: `teamrig's config document ${why}` }
}

describe('configOf', () => {
  test("reads each setting the views take from the row of its key, in the document's zone", () => {
    expect(configOf(documentOf())).toEqual({ kind: 'read', value: { kind: 'team', team: 'kit', settings: SETTINGS }, problems: [] })
  })

  test('reads a row marked with a problem as its default, as teamrig reads the key', () => {
    const refused = { problem: 'the value fails the config check and the default is used; teamrig config validate says why', isDefault: false }
    const read = configOf(
      documentOf({
        settings: rows([
          setting('register.ownerSource', 'x'.repeat(400), { default: 'owner', ...refused }),
          setting('focus.score.rankValues', [-1], { default: [100, 70], ...refused }),
        ]),
      }),
    )
    expect(read.kind === 'read' && read.value.kind === 'team' ? read.value.settings.ownerSource : null).toBe('owner')
    expect(read.kind === 'read' && read.value.kind === 'team' ? read.value.settings.focus.score.rankValues : null).toEqual([100, 70])
  })

  test('passes over an entry that is no row or names no path, and of two rows with one path takes the later', () => {
    const settings = ['a bare row', setting('register.ownerSource', 'first'), { value: 'no path' }, { path: 7, value: 'a numbered path' }, ...rows()]
    expect(configOf(documentOf({ settings }))).toEqual({ kind: 'read', value: { kind: 'team', team: 'kit', settings: SETTINGS }, problems: [] })
  })

  test("a served path that names an object's built-in changes nothing", () => {
    const settings = [setting('__proto__', { ownerSource: 'planted' }), setting('constructor', 'planted'), ...rows()]
    expect(configOf(documentOf({ settings }))).toEqual({ kind: 'read', value: { kind: 'team', team: 'kit', settings: SETTINGS }, problems: [] })
  })

  test('with no team, names the teams of the machine to join and its zone', () => {
    const read = configOf(documentOf({ team: null, teams: ['kit', 'web'], timeZone: 'Europe/Paris', priorities: [], settings: [] }))
    expect(read).toEqual({ kind: 'read', value: { kind: 'no-team', teams: ['kit', 'web'], timeZone: 'Europe/Paris' }, problems: [] })
  })

  test('answers every text with nothing in it a terminal would act on', () => {
    const team = configOf(documentOf({ team: 'k\u001bit', settings: rows([setting('register.ownerSource', 'bo‮ss\u009b2J'), setting('focus.roadmapClass', 'Road\u0007map')]) }))
    expect(team.kind === 'read' && team.value.kind === 'team' ? team.value.team : null).toBe(`k${CONTROL_SHOWN}it`)
    expect(team.kind === 'read' && team.value.kind === 'team' ? team.value.settings.ownerSource : null).toBe(`boss${CONTROL_SHOWN}2J`)
    expect(team.kind === 'read' && team.value.kind === 'team' ? team.value.settings.focus.roadmapClass : null).toBe(`Road${CONTROL_SHOWN}map`)
    const none = configOf(documentOf({ team: null, teams: ['we\u001bb'], timeZone: 'Europe/\u0007Paris', settings: [] }))
    expect(none.kind === 'read' ? none.value : null).toEqual({ kind: 'no-team', teams: [`we${CONTROL_SHOWN}b`], timeZone: `Europe/${CONTROL_SHOWN}Paris` })
  })

  test('a document with a team, team list or zone of another type is unreadable, naming the field', () => {
    expect(configOf(documentOf({ team: 4 }))).toEqual(unreadable('cannot be read (team): update teamrig'))
    expect(configOf(documentOf({ teams: 'kit' }))).toEqual(unreadable('cannot be read (teams): update teamrig'))
    expect(configOf(documentOf({ timeZone: null }))).toEqual(unreadable('cannot be read (timeZone): update teamrig'))
  })

  test('a document with no setting list is unreadable, with a team or none', () => {
    expect(configOf(documentOf({ settings: null }))).toEqual(unreadable('holds no setting list: update teamrig'))
    expect(configOf(documentOf({ team: null, settings: {} }))).toEqual(unreadable('holds no setting list: update teamrig'))
  })

  test('a setting the pane draws with that is missing or of another type makes the document unreadable, naming the first', () => {
    const without = (path: string): JsonRecord[] => rows().filter(row => row['path'] !== path)
    const both = 'update teamrig and teamrig-pane'
    expect(configOf(documentOf({ settings: without('focus.parkAfterDays') }))).toEqual(unreadable(`cannot be read (setting focus.parkAfterDays): ${both}`))
    expect(configOf(documentOf({ settings: rows([setting('focus.expedite.critical', 'yes')]) }))).toEqual(unreadable(`cannot be read (setting focus.expedite.critical): ${both}`))
    expect(configOf(documentOf({ settings: rows([setting('focus.score.ownerOrderValues', [140, '120']), setting('focus.score.minSizePct', null)]) }))).toEqual(
      unreadable(`cannot be read (setting focus.score.ownerOrderValues): ${both}`),
    )
    expect(configOf(documentOf({ settings: [] }))).toEqual(unreadable(`cannot be read (setting register.check.notPickedUpAfterHours): ${both}`))
  })
})
