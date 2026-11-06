import { describe, expect, test } from 'claude-code/testing'
import type { OwnerSettings } from '../types'
import { DEFAULT_FOCUS, readRegister, TimeZone } from '../hooks/core/read/index'
import { laterWords, ownerCardsOf } from '../hooks/owner-cards'
import { HOUR, JERUSALEM, NOW, createLine, waitingLine, type CardFields } from './fixtures'

/** teamrig's default: the owner marker `owner`, a decision on the owner needs a card naming its gate, and its ranking. */
const SETTINGS: OwnerSettings = { ownerSource: 'owner', requireDecisionCard: true, focus: DEFAULT_FOCUS }

const GATED: CardFields = { question: 'Ship the analytics tab?', options: ['A: now', 'B: next week'], recommend: 'A', byDefault: 'B', gate: 'product' }
const UNGATED: CardFields = { question: 'Which colour?', options: ['A: green', 'B: blue'], recommend: 'A', byDefault: 'A' }

function cardsOf(lines: readonly string[], settings: OwnerSettings = SETTINGS, now: number = NOW, zone: TimeZone = TimeZone.UTC) {
  return ownerCardsOf(readRegister(lines.join('\n')).state.tasks, now, zone, settings)
}

describe('ownerCardsOf', () => {
  test('a decision on the owner is due now for the session that owns its task', () => {
    const cards = cardsOf([
      createLine('T1', { owner: 'pane', by: 'lead', at: NOW - 3 * HOUR, title: 'Analytics tab' }),
      waitingLine('T1', 'pane', NOW - 2 * HOUR, [{ kind: 'decision', who: 'owner' }], null, GATED),
    ])
    expect(cards).toEqual({ pane: { due: [{ id: 'T1', title: 'Analytics tab' }], later: [] } })
  })

  test('an approval on the owner counts, with or without a card', () => {
    const cards = cardsOf([
      createLine('T1', { owner: 'pane', by: 'lead', at: NOW - 3 * HOUR }),
      waitingLine('T1', 'pane', NOW - 2 * HOUR, [{ kind: 'approval', who: 'owner' }]),
    ])
    expect(cards['pane']?.due.map(card => card.id)).toEqual(['T1'])
  })

  test('a decision on anyone else is not the owner’s', () => {
    const cards = cardsOf([
      createLine('T1', { owner: 'pane', by: 'lead', at: NOW - 3 * HOUR }),
      waitingLine('T1', 'pane', NOW - 2 * HOUR, [{ kind: 'decision', who: 'lead' }], null, GATED),
    ])
    expect(cards).toEqual({})
  })

  test('a decision with a card naming no gate is its leader’s while cards need a gate, the owner’s when they do not', () => {
    const lines = [
      createLine('T1', { owner: 'pane', by: 'lead', at: NOW - 3 * HOUR }),
      waitingLine('T1', 'pane', NOW - 2 * HOUR, [{ kind: 'decision', who: 'owner' }], null, UNGATED),
    ]
    expect(cardsOf(lines)).toEqual({})
    expect(cardsOf(lines, { ...SETTINGS, requireDecisionCard: false })['pane']?.due.map(card => card.id)).toEqual(['T1'])
  })

  test('a decision with no card still counts: check flags it NO-CARD, and the owner still holds it', () => {
    const cards = cardsOf([
      createLine('T1', { owner: 'pane', by: 'lead', at: NOW - 3 * HOUR }),
      waitingLine('T1', 'pane', NOW - 2 * HOUR, [{ kind: 'decision', who: 'owner' }]),
    ])
    expect(cards['pane']?.due.map(card => card.id)).toEqual(['T1'])
  })

  test('the owner marker comes from the config', () => {
    const lines = [
      createLine('T1', { owner: 'pane', by: 'lead', at: NOW - 3 * HOUR }),
      waitingLine('T1', 'pane', NOW - 2 * HOUR, [{ kind: 'decision', who: 'boss' }], null, GATED),
    ]
    expect(cardsOf(lines)).toEqual({})
    expect(cardsOf(lines, { ...SETTINGS, ownerSource: 'boss' })['pane']?.due.map(card => card.id)).toEqual(['T1'])
  })

  test('a card put off to a day is later, named by its weekday, through that day, and due once it ends', () => {
    const lines = [
      createLine('T1', { owner: 'pane', by: 'lead', at: NOW - 3 * HOUR, title: 'Analytics tab' }),
      waitingLine('T1', 'pane', NOW - 2 * HOUR, [{ kind: 'decision', who: 'owner' }, { kind: 'time', at: '2026-10-16' }], null, GATED),
    ]
    expect(cardsOf(lines)).toEqual({ pane: { due: [], later: [{ id: 'T1', title: 'Analytics tab', until: 'Fri 10-16' }] } })
    expect(cardsOf(lines, SETTINGS, Date.UTC(2026, 9, 16, 23, 0))['pane']?.later.map(card => card.id)).toEqual(['T1'])
    expect(cardsOf(lines, SETTINGS, Date.UTC(2026, 9, 17, 0, 0))['pane']?.due.map(card => card.id)).toEqual(['T1'])
  })

  test('a card put off to a minute is later, named on the team zone’s clock', () => {
    const cards = cardsOf(
      [
        createLine('T1', { owner: 'pane', by: 'lead', at: NOW - 3 * HOUR }),
        waitingLine('T1', 'pane', NOW - 2 * HOUR, [{ kind: 'decision', who: 'owner' }, { kind: 'time', at: '2026-10-16 09:00' }], null, GATED),
      ],
      SETTINGS,
      NOW,
      JERUSALEM,
    )
    expect(cards['pane']?.later.map(card => card.until)).toEqual(['10-16 12:00 IDT'])
  })

  test('a session’s Later cards come soonest back first, whatever their plan order', () => {
    const cards = cardsOf([
      createLine('T1', { owner: 'pane', by: 'lead', at: NOW - 3 * HOUR, priority: 1 }),
      createLine('T2', { owner: 'pane', by: 'lead', at: NOW - 3 * HOUR, priority: 3 }),
      waitingLine('T1', 'pane', NOW - 2 * HOUR, [{ kind: 'decision', who: 'owner' }, { kind: 'time', at: '2026-10-20' }], null, GATED),
      waitingLine('T2', 'pane', NOW - 2 * HOUR, [{ kind: 'decision', who: 'owner' }, { kind: 'time', at: '2026-10-18' }], null, GATED),
    ])
    expect(cards['pane']?.later.map(card => card.id)).toEqual(['T2', 'T1'])
  })

  test('a card put off to a minute of a day comes back before one put off to that whole day', () => {
    const cards = cardsOf([
      createLine('T1', { owner: 'pane', by: 'lead', at: NOW - 3 * HOUR, priority: 1 }),
      createLine('T2', { owner: 'pane', by: 'lead', at: NOW - 3 * HOUR, priority: 3 }),
      waitingLine('T1', 'pane', NOW - 2 * HOUR, [{ kind: 'decision', who: 'owner' }, { kind: 'time', at: '2026-10-16' }], null, GATED),
      waitingLine('T2', 'pane', NOW - 2 * HOUR, [{ kind: 'decision', who: 'owner' }, { kind: 'time', at: '2026-10-16 09:00' }], null, GATED),
    ])
    expect(cards['pane']?.later.map(card => card.id)).toEqual(['T2', 'T1'])
  })

  test('each session gets its own cards, in plan order', () => {
    const cards = cardsOf([
      createLine('T1', { owner: 'pane', by: 'lead', at: NOW - 3 * HOUR, priority: 3 }),
      createLine('T2', { owner: 'pane', by: 'lead', at: NOW - 3 * HOUR, priority: 1 }),
      createLine('T3', { owner: 'docs', by: 'lead', at: NOW - 3 * HOUR }),
      waitingLine('T1', 'pane', NOW - 2 * HOUR, [{ kind: 'decision', who: 'owner' }], null, GATED),
      waitingLine('T2', 'pane', NOW - 2 * HOUR, [{ kind: 'approval', who: 'owner' }]),
      waitingLine('T3', 'docs', NOW - 2 * HOUR, [{ kind: 'approval', who: 'owner' }]),
    ])
    expect(Object.keys(cards).sort()).toEqual(['docs', 'pane'])
    expect(cards['pane']?.due.map(card => card.id)).toEqual(['T2', 'T1'])
    expect(cards['docs']?.due.map(card => card.id)).toEqual(['T3'])
  })

  test('a session’s cards follow the team’s focus: with an owner’s order turned off, the ids settle them', () => {
    const lines = [
      createLine('T1', { owner: 'pane', by: 'lead', at: NOW - 3 * HOUR, priority: 3 }),
      createLine('T2', { owner: 'pane', by: 'lead', at: NOW - 3 * HOUR, priority: 1 }),
      waitingLine('T1', 'pane', NOW - 2 * HOUR, [{ kind: 'approval', who: 'owner' }]),
      waitingLine('T2', 'pane', NOW - 2 * HOUR, [{ kind: 'approval', who: 'owner' }]),
    ]
    const focus = { ...DEFAULT_FOCUS, expedite: { ...DEFAULT_FOCUS.expedite, ownerP1: false }, score: { ...DEFAULT_FOCUS.score, ownerOrderValues: [] } }
    expect(cardsOf(lines)['pane']?.due.map(card => card.id)).toEqual(['T2', 'T1'])
    expect(cardsOf(lines, { ...SETTINGS, focus })['pane']?.due.map(card => card.id)).toEqual(['T1', 'T2'])
  })
})

describe('laterWords', () => {
  test('a bare day reads as its weekday and date, whatever the zone', () => {
    expect(laterWords('2026-11-02', JERUSALEM)).toBe('Mon 11-02')
  })

  test('a minute is UTC as stored and reads on the zone’s clock', () => {
    expect(laterWords('2026-11-02 10:00', JERUSALEM)).toBe('11-02 12:00 IST')
  })
})
