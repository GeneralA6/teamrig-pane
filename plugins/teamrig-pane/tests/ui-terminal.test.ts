// The terminal port over fake streams: what taking the screen writes, a frame as written, keys and sizes told to the
// app, and all of it given back once on close.
import { describe, expect, test } from 'claude-code/testing'
import type { Key } from '../ui/keys'
import type { Size } from '../ui/paint'
import { words } from '../ui/run'
import { ENTER, FALLBACK, LEAVE, openTerminal, screenText, type Input, type Output } from '../ui/terminal'

const ESC = '\u001b'

type FakeInput = Input & { readonly calls: string[]; send(chunk: string): void }

function fakeInput(isTerminal: boolean): FakeInput {
  const calls: string[] = []
  let listeners: ((chunk: string) => void)[] = []
  const streams = {
    calls,
    setEncoding(encoding: 'utf8') {
      calls.push(`encoding ${encoding}`)
    },
    resume() {
      calls.push('resume')
    },
    pause() {
      calls.push('pause')
    },
    on(_event: 'data', listener: (chunk: string) => void) {
      listeners = [...listeners, listener]
    },
    off(_event: 'data', listener: (chunk: string) => void) {
      listeners = listeners.filter(each => each !== listener)
    },
    send(chunk: string) {
      for (const listener of listeners) listener(chunk)
    },
  }
  if (!isTerminal) return streams
  return {
    ...streams,
    setRawMode(raw: boolean) {
      calls.push(`raw ${String(raw)}`)
    },
  }
}

type FakeOutput = Output & { readonly written: string[]; resize(): void }

function fakeOutput(size: Size | null): FakeOutput {
  const written: string[] = []
  let listeners: (() => void)[] = []
  return {
    written,
    ...(size === null ? {} : size),
    write(text: string) {
      written.push(text)
    },
    on(_event: 'resize', listener: () => void) {
      listeners = [...listeners, listener]
    },
    off(_event: 'resize', listener: () => void) {
      listeners = listeners.filter(each => each !== listener)
    },
    resize() {
      for (const listener of listeners) listener()
    },
  }
}

describe('a frame as a terminal reads it', () => {
  test('starts at the first cell, clears each line to its end and what is below, and breaks no line after the last', () => {
    expect(screenText([[words('one')], [words('two')]])).toBe(`${ESC}[Hone${ESC}[K\r\ntwo${ESC}[K${ESC}[J`)
  })

  test('a frame of no lines only clears the screen', () => {
    expect(screenText([])).toBe(`${ESC}[H${ESC}[J`)
  })
})

describe('the terminal over a process streams', () => {
  test('takes the screen and the raw input at once', () => {
    const input = fakeInput(true)
    const output = fakeOutput({ columns: 100, rows: 30 })
    openTerminal(input, output)
    expect(input.calls).toEqual(['raw true', 'encoding utf8', 'resume'])
    expect(output.written).toEqual([ENTER])
  })

  test('draws a frame as its screen text', () => {
    const output = fakeOutput({ columns: 100, rows: 30 })
    const terminal = openTerminal(fakeInput(true), output)
    terminal.draw([[words('one')]])
    expect(output.written).toEqual([ENTER, screenText([[words('one')]])])
  })

  test('answers the output cells, and those of a common terminal for an output that is none', () => {
    expect(openTerminal(fakeInput(true), fakeOutput({ columns: 100, rows: 30 })).size()).toEqual({ columns: 100, rows: 30 })
    expect(openTerminal(fakeInput(false), fakeOutput(null)).size()).toEqual(FALLBACK)
  })

  test('tells every listener of each key read, in order', () => {
    const input = fakeInput(true)
    const terminal = openTerminal(input, fakeOutput(null))
    const first: Key[] = []
    const second: Key[] = []
    terminal.onKey(key => first.push(key))
    terminal.onKey(key => second.push(key))
    input.send(`a\t${ESC}[<0;3;2M`)
    const read: Key[] = [
      { kind: 'char', char: 'a' },
      { kind: 'key', name: 'tab' },
      { kind: 'click', column: 2, line: 1 },
    ]
    expect(first).toEqual(read)
    expect(second).toEqual(read)
  })

  test('tells of the cells when the screen changes', () => {
    const output = fakeOutput({ columns: 100, rows: 30 })
    const terminal = openTerminal(fakeInput(true), output)
    const sizes: Size[] = []
    terminal.onResize(size => sizes.push(size))
    output.resize()
    expect(sizes).toEqual([{ columns: 100, rows: 30 }])
  })

  test('close gives the screen and the input back, and hears nothing after', () => {
    const input = fakeInput(true)
    const output = fakeOutput({ columns: 100, rows: 30 })
    const terminal = openTerminal(input, output)
    const keys: Key[] = []
    const sizes: Size[] = []
    terminal.onKey(key => keys.push(key))
    terminal.onResize(size => sizes.push(size))
    terminal.close()
    input.send('a')
    output.resize()
    terminal.draw([[words('late')]])
    expect(output.written).toEqual([ENTER, LEAVE])
    expect(input.calls).toEqual(['raw true', 'encoding utf8', 'resume', 'raw false', 'pause'])
    expect(keys).toEqual([])
    expect(sizes).toEqual([])
  })

  test('a second close does nothing', () => {
    const input = fakeInput(true)
    const output = fakeOutput(null)
    const terminal = openTerminal(input, output)
    terminal.close()
    terminal.close()
    expect(output.written).toEqual([ENTER, LEAVE])
    expect(input.calls.filter(call => call === 'pause')).toHaveLength(1)
  })

  test('an input that is no terminal is read as it comes, with no raw mode', () => {
    const input = fakeInput(false)
    const terminal = openTerminal(input, fakeOutput(null))
    terminal.close()
    expect(input.calls).toEqual(['encoding utf8', 'resume', 'pause'])
  })
})
