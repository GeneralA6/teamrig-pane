// The team's settings from teamrig's `config` document (T4742): the config keys the pane's views read, each taken
// from the row teamrig serves for it, into the settings the views already take (types/index.d.ts TeamSettings), so
// nothing downstream changes with where a setting came from. The document serves every key of the team config as a
// row under its dotted path; the pane asks for the few it draws with and never looks at the rest, so a key a later
// teamrig adds passes through unseen. A row teamrig marks with a `problem` holds a value its config check refused,
// which teamrig itself reads as the default: the pane takes the row's `default` there, so both rank and count alike.
// Every setting asked for here is one some drawing needs, so one that is missing or of another type makes the
// document unreadable, naming its path, rather than a view drawn from a guess. The zone is the document's own
// `timeZone`, which teamrig already settled (the config's, else the machine's). With no team the document names the
// machine's teams to join, which the not-set-up view lists. An `unchanged` answer holds no settings, so it is never
// handed here. Pure.
import type { TeamSettings } from '../types'
import { Fields, isList, type BodyRead } from './document-fields'
import { isRecord, type ReadDocument } from './read-document'

/** What the `config` document says: a team's settings, or with no team the machine's teams to join one of. */
export type SettingsRead =
  | { readonly kind: 'team'; readonly team: string; readonly settings: TeamSettings }
  | { readonly kind: 'no-team'; readonly teams: readonly string[]; readonly timeZone: string }

/**
 * What teamrig reads each served key as, by its path: the row's `value`, or its `default` on a row marked with a
 * `problem`. An entry that is no row, or names no path, is passed over; of two rows with one path the later holds.
 */
function servedValues(rows: readonly unknown[]): ReadonlyMap<string, unknown> {
  const values = new Map<string, unknown>()
  for (const row of rows) {
    if (!isRecord(row)) continue
    const path = row['path']
    if (typeof path !== 'string') continue
    values.set(path, typeof row['problem'] === 'string' ? row['default'] : row['value'])
  }
  return values
}

/**
 * The served settings, read one path at a time with the type its drawing takes, the paths that could not be read
 * noted as `setting <path>`. A value is read through a record of its one field, keyed by the path asked: that path
 * is the pane's own word, so no served path is ever made a key of an object.
 */
class Settings {
  private readonly values: ReadonlyMap<string, unknown>
  private readonly noted: string[]

  constructor(values: ReadonlyMap<string, unknown>) {
    this.values = values
    this.noted = []
  }

  /** The settings that could not be read, in the order they were asked. */
  get bad(): readonly string[] {
    return [...this.noted]
  }

  text(path: string): string {
    return this.at(path).text(path)
  }

  number(path: string): number {
    return this.at(path).number(path)
  }

  flag(path: string): boolean {
    return this.at(path).flag(path)
  }

  numbers(path: string): readonly number[] {
    return this.at(path).numbers(path)
  }

  private at(path: string): Fields {
    return new Fields({ [path]: this.values.get(path) }, 'setting ', this.noted)
  }
}

/** The settings the views take, each from its config key, in the team's zone. */
function teamSettings(served: Settings, timeZone: string): TeamSettings {
  return {
    notPickedUpAfterHours: served.number('register.check.notPickedUpAfterHours'),
    timeZone,
    ownerSource: served.text('register.ownerSource'),
    requireDecisionCard: served.flag('register.requireDecisionCard'),
    focus: {
      defaultClass: served.text('focus.defaultClass'),
      roadmapClass: served.text('focus.roadmapClass'),
      maintenanceClass: served.text('focus.maintenanceClass'),
      parkAfterDays: served.number('focus.parkAfterDays'),
      score: {
        rankValues: served.numbers('focus.score.rankValues'),
        roadmapUnranked: served.number('focus.score.roadmapUnranked'),
        maintenanceValue: served.number('focus.score.maintenanceValue'),
        maintenanceBug: served.number('focus.score.maintenanceBug'),
        maintenanceCritical: served.number('focus.score.maintenanceCritical'),
        improvementsValue: served.number('focus.score.improvementsValue'),
        overdueValue: served.number('focus.score.overdueValue'),
        dueSoonValue: served.number('focus.score.dueSoonValue'),
        dueSoonDays: served.number('focus.score.dueSoonDays'),
        unblocksShare: served.number('focus.score.unblocksShare'),
        ownerOrderValues: served.numbers('focus.score.ownerOrderValues'),
        defaultSizePct: served.number('focus.score.defaultSizePct'),
        minSizePct: served.number('focus.score.minSizePct'),
      },
      expedite: { critical: served.flag('focus.expedite.critical'), ownerP1: served.flag('focus.expedite.ownerP1') },
    },
  }
}

function unreadable(why: string): BodyRead<SettingsRead> {
  return { kind: 'unreadable', reason: `teamrig's config document ${why}` }
}

/**
 * What `document` says of the team's settings; unreadable with no team field, team list, zone or setting list, which
 * every `config` document of this major holds, and with a setting the pane draws with missing or of another type:
 * the keys go with teamrig's version, so there either side may be the older one.
 */
export function configOf(document: ReadDocument): BodyRead<SettingsRead> {
  const head = new Fields(document.fields)
  const team = head.textOrNull('team')
  const teams = head.texts('teams')
  const timeZone = head.text('timeZone')
  const [missing] = head.bad
  if (missing !== undefined) return unreadable(`cannot be read (${missing}): update teamrig`)
  const rows = document.fields['settings']
  if (!isList(rows)) return unreadable('holds no setting list: update teamrig')
  if (team === null) return { kind: 'read', value: { kind: 'no-team', teams, timeZone }, problems: [] }
  const served = new Settings(servedValues(rows))
  const settings = teamSettings(served, timeZone)
  const [unread] = served.bad
  if (unread !== undefined) return unreadable(`cannot be read (${unread}): update teamrig and teamrig-pane`)
  return { kind: 'read', value: { kind: 'team', team, settings }, problems: [] }
}
