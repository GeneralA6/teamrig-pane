// The snapshot the views draw, with what `teamrig read` serves laid over what the pane still folds from the team's
// files (T4742): the task rows, the area with its name and inbox, who leads whom and the drawn settings come from
// the `tasks`, `inbox`, `sessions` and `config` documents; the files keep feeding what no document serves yet, ids
// and numbers only (the work marks, goals' ranks, spend, task counts, whose cards wait on the owner, and the other
// teams' tasks the own ones are judged by, of which only the id, status and numbers are read). A title is drawn from
// a document's row or not at all: an owner card whose task the rows lack is left out, and until the first tasks
// document is read the list is empty under the reason, never the fold's rows. A failed run, or a document that
// cannot be read, keeps what was last drawn and names why. Runs the CLI only; no model calls.
import { configOf, type SettingsRead } from './config-document'
import type { BodyRead } from './document-fields'
import { isHeldFinished } from './done'
import { inboxShown } from './inbox'
import { inboxOf, type InboxRead } from './inbox-document'
import type { DocumentName, ReadDocument } from './read-document'
import { readDocuments, type ReadPorts } from './read-port'
import { nameOf, leadsOf } from './session-roster'
import { sessionsOf, type SessionsRead } from './sessions-document'
import { shownText } from './shown-text'
import { joinedProblems, type PollInput } from './source'
import { tasksOf } from './tasks-document'
import type { TeamrigCli } from './teamrig-cli'
import { isActive } from './view'
import type { DrawnSettings, SessionOwnerCards, Snapshot, TaskRow } from '../types'

/**
 * How long the documents stand unread while no file the pane watches moves: a change the files do not show (a
 * session's state, a rename made on another machine's mount) is drawn within it. Each read hands back the revisions
 * held, so teamrig builds only what moved.
 */
export const READ_EVERY_MS = 60_000

/** What a poll answers: a snapshot when anything it draws from changed (or `force`), else null. */
export type SnapshotSource = { poll(input: PollInput): Promise<Snapshot | null> }

/** One document as the source holds it between reads. */
class Held<T> {
  /** The last value read; null until one is. */
  value: T | null = null
  /** The revision of `value`, handed back so teamrig answers `unchanged` for it; null with none held. */
  revision: string | null = null
  /** What teamrig and the reader could not serve of `value`. */
  private problems: readonly string[] = []
  /** Why the newest answer could not be read; null when it was, or said nothing changed. */
  trouble: string | null = null
  private readonly reader: (document: ReadDocument) => BodyRead<T>

  constructor(reader: (document: ReadDocument) => BodyRead<T>) {
    this.reader = reader
  }

  /**
   * Takes a run's answer. One that cannot be read keeps the value last drawn and its revision, so the next run reads
   * the document whole again and the reason stays until it can be read.
   */
  take(document: ReadDocument): void {
    if (document.isUnchanged) {
      this.trouble = null
      return
    }
    const read = this.reader(document)
    if (read.kind === 'unreadable') {
      this.trouble = read.reason
      return
    }
    this.value = read.value
    this.revision = document.revision
    this.problems = [...document.problems, ...read.problems]
    this.trouble = null
  }

  /** The lines to show for this document. */
  get lines(): readonly string[] {
    return this.trouble === null ? this.problems : [...this.problems, this.trouble]
  }
}

/** The documents every read asks for; `inbox` joins them once the area is known to be on the team. */
const ALWAYS: readonly DocumentName[] = ['tasks', 'sessions', 'config']

/** Where the pane's conversation stands on `team`, as the held sessions document says. */
type Place = {
  /** The session drawn: the pinned one, else the session of `team` this conversation runs. */
  readonly area: string | null
  /** The area's name on the team; null for no area, or one the document does not hold on the team now. */
  readonly areaName: string | null
}

/**
 * Each session's cards on the owner with the titles `rows` serve: the fold says whose tasks wait on the owner, the
 * document how each is titled. A card whose task the rows lack is left out, and a session left with none is absent.
 */
export function titledCards(cards: Snapshot['ownerCards'], rows: readonly TaskRow[]): Snapshot['ownerCards'] {
  const titles = new Map(rows.map(row => [row.id, row.title]))
  const titled: Record<string, SessionOwnerCards> = {}
  for (const [session, { due, later }] of Object.entries(cards)) {
    const dueNow = due.flatMap(({ id }) => {
      const title = titles.get(id)
      return title === undefined ? [] : [{ id, title }]
    })
    const putOff = later.flatMap(({ id, until }) => {
      const title = titles.get(id)
      return title === undefined ? [] : [{ id, title, until: shownText(until) }]
    })
    if (dueNow.length > 0 || putOff.length > 0) titled[session] = { due: dueNow, later: putOff }
  }
  return titled
}

export class DocumentSource implements SnapshotSource {
  private readonly files: SnapshotSource
  private readonly cli: TeamrigCli
  private readonly ports: ReadPorts
  private readonly tasks = new Held(tasksOf)
  private readonly inbox = new Held(inboxOf)
  private readonly sessions = new Held(sessionsOf)
  private readonly config = new Held(configOf)
  private readonly held: Readonly<Record<DocumentName, { take(document: ReadDocument): void }>>
  /** The file source's last snapshot: a poll of it answers null while nothing it reads moved. */
  private base: Snapshot | null = null
  /** When the documents were last asked for; null before the first read. */
  private readAt: number | null = null
  /** What the last read's runs could not answer. */
  private runProblems: readonly string[] = []

  constructor(files: SnapshotSource, cli: TeamrigCli, ports: ReadPorts) {
    this.files = files
    this.cli = cli
    this.ports = ports
    this.held = { tasks: this.tasks, inbox: this.inbox, sessions: this.sessions, config: this.config }
  }

  /** The sessions document last read, for a caller that looks a session up by a typed word; null before one is. */
  get sessionsRead(): SessionsRead | null {
    return this.sessions.value
  }

  /** The config document last read; null before one is. */
  get settingsRead(): SettingsRead | null {
    return this.config.value
  }

  /**
   * A new snapshot when a file moved, on `force`, or when the documents were read: they are read then, and each
   * READ_EVERY_MS without one. A throw of the file source passes through, as the caller shows it.
   */
  async poll(input: PollInput): Promise<Snapshot | null> {
    const moved = await this.files.poll(input)
    if (moved !== null) this.base = moved
    const base = this.base
    if (base === null) return null
    const isDue = moved !== null || input.force === true || this.readAt === null || input.now - this.readAt >= READ_EVERY_MS
    if (!isDue) return null
    await this.read(base.team, input)
    return this.drawn(base, input)
  }

  /**
   * Reads the documents in one run, as the area when the held sessions document says it is on the team, with its
   * inbox: teamrig refuses a whole run for a session it does not know, so a pinned word it never held asks for no
   * inbox and names no session. An area first known from this run's own answer has its inbox read at once in a
   * second run. A failed run that named a session is tried again with none: a session retired since the document
   * was held must not refuse every later read, the one that would say so among them. Two runs failing for one reason
   * name it once.
   */
  private async read(team: string | null, input: PollInput): Promise<void> {
    this.readAt = input.now
    const problems: string[] = []
    const known = this.placeOf(team, input.pinned)
    let asked = known.areaName === null ? null : known.area
    let isRead = await this.run(asked === null ? ALWAYS : [...ALWAYS, 'inbox'], asked, input, problems)
    if (!isRead && asked !== null) {
      asked = null
      isRead = await this.run(ALWAYS, null, input, problems)
    }
    if (isRead) {
      const now = this.placeOf(team, input.pinned)
      if (now.area !== null && now.areaName !== null && now.area !== asked) await this.run(['inbox'], now.area, input, problems)
    }
    this.runProblems = [...new Set(problems)]
  }

  /** One run for `names` as `session`; false when it answered no document, its reason added to `problems`. */
  private async run(names: readonly DocumentName[], session: string | null, input: PollInput, problems: string[]): Promise<boolean> {
    const asks = names.map(name => ({ name, held: this.revisionOf(name, session) }))
    const result = await readDocuments(this.cli, this.ports, asks, { session, conversation: input.claudeSession })
    if (result.kind === 'failed') {
      problems.push(result.reason)
      return false
    }
    problems.push(...result.problems)
    for (const [name, document] of result.documents) this.held[name].take(document)
    return true
  }

  /** The revision to hand back for `name`; the inbox's only when it is held for the session asked as. */
  private revisionOf(name: DocumentName, session: string | null): string | null {
    if (name === 'tasks') return this.tasks.revision
    if (name === 'sessions') return this.sessions.revision
    if (name === 'config') return this.config.revision
    return this.inbox.value !== null && this.inbox.value.session.id === session ? this.inbox.revision : null
  }

  private placeOf(team: string | null, pinned: string | null): Place {
    const sessions = this.sessions.value
    const self = sessions?.self ?? null
    const area = pinned ?? (self !== null && self.team === team ? self.session : null)
    const areaName = area === null || team === null || sessions === null ? null : nameOf(sessions, team, area)
    return { area, areaName }
  }

  /** The inbox held, when it is the area's and the area is on the team: another session's is never drawn. */
  private inboxOf({ area, areaName }: Place): InboxRead | null {
    const inbox = this.inbox.value
    return inbox !== null && areaName !== null && inbox.session.id === area ? inbox : null
  }

  /**
   * The inbox's lines to show: the drawn inbox's, else why the area's could not be read. What teamrig could not serve
   * of another session's inbox, held from before the area changed, is not this area's to show.
   */
  private inboxLines({ areaName }: Place, drawn: InboxRead | null): readonly string[] {
    if (drawn !== null) return this.inbox.lines
    const why = this.inbox.trouble
    return areaName === null || why === null ? [] : [why]
  }

  /** The drawn settings of the pane's own team as the config document holds them; null before one is read. */
  private settingsOf(team: string | null): DrawnSettings | null {
    const config = this.config.value
    if (config === null || config.kind !== 'team' || config.team !== team) return null
    const { notPickedUpAfterHours, timeZone, ownerSource, focus } = config.settings
    return { notPickedUpAfterHours, timeZone, ownerSource, focus }
  }

  /** Said when teamrig answers for another team than the one whose files the pane folds: the two would not agree. */
  private otherTeam(team: string | null): string | null {
    const config = this.config.value
    if (config === null || config.kind !== 'team' || team === null || config.team === team) return null
    return `teamrig read answers for team ${config.team}, the pane found team ${team}`
  }

  private drawn(base: Snapshot, { pinned, now }: PollInput): Snapshot {
    const place = this.placeOf(base.team, pinned)
    const sessions = this.sessions.value
    const inbox = this.inboxOf(place)
    const rows = this.tasks.value ?? []
    return {
      ...base,
      ...this.settingsOf(base.team),
      tasks: rows.filter(task => isActive(task) || isHeldFinished(task, now)),
      area: place.area,
      areaSource: pinned !== null ? 'pinned' : place.area !== null ? 'inbox-read' : null,
      areaName: place.areaName,
      leads: sessions === null || base.team === null ? null : leadsOf(sessions, base.team),
      unreadInbox: inbox?.unread ?? null,
      inbox: inbox === null ? [] : inboxShown(inbox.items, now),
      ownerCards: titledCards(base.ownerCards, rows),
      problem: joinedProblems([
        base.problem,
        ...this.runProblems,
        ...this.tasks.lines,
        ...this.sessions.lines,
        ...this.config.lines,
        ...this.inboxLines(place, inbox),
        this.otherTeam(base.team),
      ]),
      now,
    }
  }
}
