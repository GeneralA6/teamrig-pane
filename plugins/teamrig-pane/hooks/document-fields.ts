// The fields of one record of a `teamrig read` document, read by name (T4742). A document is JSON another program
// printed, so no field has a type until it is looked at. Each reader here names the type it takes: a value of that
// type is answered as it is, and any other is noted under the field's path with a stand-in answered in its place, so
// a caller reads the whole record first and asks once, at the end, whether it may use what it built (`bad`). A record
// that noted anything must not be used: its stand-ins mean nothing. An optional field is one teamrig serves as null or
// leaves out: both read null, and only a value of another type is noted. A field no reader asks for is never looked
// at, so what a later minor adds passes through unseen. Every text leaves here as the pane may draw it
// (shown-text.ts), the word a noted path quotes too: this is the one door a served text takes into a view, so no
// reader can forget to clean one. Pure.
import { isRecord, type JsonRecord } from './read-document'
import { shownText } from './shown-text'

/** What a document's own reader made of it: its value with what it left out, as lines to show; or why it read none. */
export type BodyRead<T> =
  | { readonly kind: 'read'; readonly value: T; readonly problems: readonly string[] }
  | { readonly kind: 'unreadable'; readonly reason: string }

export function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value)
}

function isText(value: unknown): value is string {
  return typeof value === 'string'
}

/** JSON spells no NaN, but a number too large to hold parses as Infinity: neither is a number a field can mean. */
function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isFlag(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

function isTexts(value: unknown): value is readonly string[] {
  return isList(value) && value.every(isText)
}

/** Whether `value` is one of the words `known` lists, each as a key: only its own keys, never an object's built-ins. */
export function isOneOf<Word extends string>(known: Readonly<Record<Word, true>>, value: string): value is Word {
  return Object.hasOwn(known, value)
}

/** How many left-out records a problem line names before it only counts the rest. */
const NAMED = 3

/**
 * The one line for the records of a document the pane left out, each of `left` naming one and why. The pane is the
 * side to update: within a major teamrig only adds, so what the pane cannot read is what it does not know yet.
 */
export function leftOutLine(what: string, left: readonly string[]): string {
  const more = left.length > NAMED ? ` and ${left.length - NAMED} more` : ''
  return `teamrig served ${left.length} ${what}${left.length === 1 ? '' : 's'} the pane cannot read, ${left.slice(0, NAMED).join(', ')}${more}: update teamrig-pane`
}

const NO_FIELDS: JsonRecord = {}

/** One record's fields, read by name, with the ones that could not be read noted for it and the records inside it. */
export class Fields {
  private readonly record: JsonRecord
  /** Where the record sits in the one first read, as the start of its fields' paths: empty at the top, `answer.` inside it. */
  private readonly prefix: string
  /** The paths noted so far, one list shared with the records read inside this one. */
  private readonly noted: string[]

  constructor(record: JsonRecord, prefix = '', noted: string[] = []) {
    this.record = record
    this.prefix = prefix
    this.noted = noted
  }

  /**
   * The paths of the fields that could not be read, in the order they were asked; a word outside its known set
   * follows its path, quoted. A record standing in for a missing one notes each field asked of it too.
   */
  get bad(): readonly string[] {
    return [...this.noted]
  }

  text(name: string): string {
    return shownText(this.required(name, isText, ''))
  }

  textOrNull(name: string): string | null {
    const value = this.optional(name, isText)
    return value === null ? null : shownText(value)
  }

  number(name: string): number {
    return this.required(name, isNumber, 0)
  }

  numberOrNull(name: string): number | null {
    return this.optional(name, isNumber)
  }

  flag(name: string): boolean {
    return this.required(name, isFlag, false)
  }

  /** A list of texts; one entry of another type and the whole field is noted. */
  texts(name: string): readonly string[] {
    return this.required(name, isTexts, []).map(shownText)
  }

  /**
   * A text that must be one of `known`'s words, for a field whose every value the pane draws its own way. A word a
   * later minor added is noted with the word, since the pane cannot draw the record without knowing it.
   */
  oneOf<Word extends string>(name: string, known: Readonly<Record<Word, true>>, standIn: Word): Word {
    const value = this.record[name]
    if (!isText(value)) return this.note(name, standIn)
    return isOneOf(known, value) ? value : this.note(`${name} ${JSON.stringify(shownText(value))}`, standIn)
  }

  /** The record in a field. */
  part(name: string): Fields {
    return this.inside(name, this.required(name, isRecord, NO_FIELDS))
  }

  partOrNull(name: string): Fields | null {
    const record = this.optional(name, isRecord)
    return record === null ? null : this.inside(name, record)
  }

  /** The records in a list field, in its order; an entry that is no record is noted and left out. */
  parts(name: string): Fields[] {
    return this.required(name, isList, []).flatMap((value, index) => {
      const path = `${name}[${index}]`
      if (isRecord(value)) return [this.inside(path, value)]
      this.note(path, null)
      return []
    })
  }

  private inside(path: string, record: JsonRecord): Fields {
    return new Fields(record, `${this.prefix}${path}.`, this.noted)
  }

  private required<T>(name: string, isType: (value: unknown) => value is T, standIn: T): T {
    const value = this.record[name]
    return isType(value) ? value : this.note(name, standIn)
  }

  private optional<T>(name: string, isType: (value: unknown) => value is T): T | null {
    const value = this.record[name]
    if (value === undefined || value === null) return null
    return isType(value) ? value : this.note(name, null)
  }

  private note<T>(path: string, standIn: T): T {
    this.noted.push(`${this.prefix}${path}`)
    return standIn
  }
}
