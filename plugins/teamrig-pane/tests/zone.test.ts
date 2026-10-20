import { describe, expect, test } from 'claude-code/testing'
import { TimeZone } from '../hooks/core/read/index'
import { clockOf, dayOf, machineZoneOf, zoneNamed } from '../hooks/zone'
import { JERUSALEM, NOW } from './fixtures'

// NOW is Tue 2026-10-13 14:00 UTC: 17:00 IDT in Jerusalem (summer time until 10-25).
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
})
