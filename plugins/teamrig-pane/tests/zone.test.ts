import { describe, expect, test } from 'claude-code/testing'
import { TimeZone } from '../hooks/core/read/index'
import { clockOf, dayOf, machineZoneOf, momentWords, planWeekOf, weekAfter, weekOf, zoneNamed } from '../hooks/zone'
import { JERUSALEM, NOW } from './fixtures'

// NOW is Tue 2026-10-13 14:00 UTC: 17:00 IDT in Jerusalem (summer time until 10-25), in the week of Mon 10-12.
const MONDAY = Date.UTC(2026, 9, 12)
describe('zone', () => {
  test('a name reads as one TimeZone, made on first use; a name the system does not know reads as UTC', () => {
    expect(zoneNamed('Asia/Jerusalem')).toBe(JERUSALEM)
    expect(JERUSALEM.name).toBe('Asia/Jerusalem')
    expect(zoneNamed('Not/A_Zone')).toBe(TimeZone.UTC)
  })

  test("the machine's zone is the session's TZ when it names a zone, else the system's", () => {
    expect(machineZoneOf('UTC', 'Asia/Jerusalem')).toBe('UTC')
    expect(machineZoneOf('Europe/Berlin', 'Asia/Jerusalem')).toBe('Europe/Berlin')
    expect(machineZoneOf(undefined, 'Asia/Jerusalem')).toBe('Asia/Jerusalem')
    // A TZ no zone is named by, or an empty one, leaves the system's.
    expect(machineZoneOf('Not/A_Zone', 'Asia/Jerusalem')).toBe('Asia/Jerusalem')
    expect(machineZoneOf('', 'Asia/Jerusalem')).toBe('Asia/Jerusalem')
  })

  test("a snapshot's clock is when it was built, in its zone; a day is the zone's day of an instant", () => {
    const clock = clockOf({ now: NOW, timeZone: 'Asia/Jerusalem' })
    expect(clock.now).toBe(NOW)
    expect(clock.zone).toBe(JERUSALEM)
    expect(clock.zone.clock(new Date(clock.now))).toBe('17:00 IDT')
    // 21:00 UTC is midnight in Jerusalem: the next day there, the same day in UTC.
    const midnight = Date.UTC(2026, 9, 13, 21, 0)
    expect(dayOf(midnight, TimeZone.UTC)).toBe('2026-10-13')
    expect(dayOf(midnight, JERUSALEM)).toBe('2026-10-14')
    expect(dayOf(midnight - 60_000, JERUSALEM)).toBe('2026-10-13')
  })

  test("an instant prints as its clock time on the zone's day of now, else with its weekday and day", () => {
    const jerusalem = clockOf({ now: NOW, timeZone: 'Asia/Jerusalem' })
    const utc = clockOf({ now: NOW, timeZone: 'UTC' })
    expect(momentWords(NOW - 3_600_000, jerusalem)).toBe('16:00 IDT')
    // 21:00 UTC on NOW's day is the next day in Jerusalem.
    const midnight = Date.UTC(2026, 9, 13, 21, 0)
    expect(momentWords(midnight, jerusalem)).toBe('Wed 10-14 00:00 IDT')
    expect(momentWords(midnight, utc)).toBe('21:00 UTC')
    expect(momentWords(Date.UTC(2026, 9, 12, 20, 0), jerusalem)).toBe('Mon 10-12 23:00 IDT')
  })

  test('in UTC, a week starts Monday 00:00: Sunday 23:59 is the week before', () => {
    expect(weekOf(MONDAY, TimeZone.UTC)).toBe('2026-10-12')
    expect(weekOf(MONDAY - 60_000, TimeZone.UTC)).toBe('2026-10-05')
    expect(weekOf(NOW, TimeZone.UTC)).toBe('2026-10-12')
    expect(weekOf(Date.UTC(2026, 9, 18, 23, 59), TimeZone.UTC)).toBe('2026-10-12')
    // Across a month and a year.
    expect(weekOf(Date.UTC(2026, 10, 1), TimeZone.UTC)).toBe('2026-10-26')
    expect(weekOf(Date.UTC(2027, 0, 1), TimeZone.UTC)).toBe('2026-12-28')
    expect(weekAfter('2026-10-12', -1)).toBe('2026-10-05')
    expect(weekAfter('2026-12-28', 1)).toBe('2027-01-04')
  })

  test("in Jerusalem's zone, a week starts at its Monday midnight, summer time or not", () => {
    // Sunday 21:00 UTC is Monday 00:00 IDT; after summer time ends (10-25), Sunday 22:00 UTC is Monday 00:00 IST.
    expect(weekOf(Date.UTC(2026, 9, 11, 21, 0), JERUSALEM)).toBe('2026-10-12')
    expect(weekOf(Date.UTC(2026, 9, 11, 20, 59), JERUSALEM)).toBe('2026-10-05')
    expect(weekOf(MONDAY - 60_000, JERUSALEM)).toBe('2026-10-12')
    expect(weekOf(Date.UTC(2026, 9, 25, 22, 0), JERUSALEM)).toBe('2026-10-26')
    expect(weekOf(Date.UTC(2026, 9, 25, 21, 59), JERUSALEM)).toBe('2026-10-19')
  })

  test("a planning week starts on the weekday of the plan in force, by whole weeks either way; with none, Monday's", () => {
    const plan = '2026-10-07'
    expect(['2026-10-07', '2026-10-13', '2026-10-14', '2026-10-06'].map(day => planWeekOf(day, plan))).toEqual(['2026-10-07', '2026-10-07', '2026-10-14', '2026-09-30'])
    // Across a month, six weeks back: Tue 09-01 is in the week of Wed 08-26.
    expect(planWeekOf('2026-09-01', plan)).toBe('2026-08-26')
    expect(planWeekOf('2026-10-13', null)).toBe('2026-10-12')
  })
})
