// The tasks view in a project teamrig is not set up for (hooks/setup-rows.ts): why, a problem the last look found,
// then numbered steps: install teamrig while no team is on the machine, make a team, join one already made, or name
// a register outside teamrig.
import { describe, expect, test } from 'claude-code/testing'
import type { ProjectSetup } from '../types'
import type { Block } from '../hooks/rows'
import { INSTALL_LINES, setupBlocks } from '../hooks/setup-rows'

const SETUP: ProjectSetup = { project: 'C:/w/app', teams: [], settingsPath: 'C:/Homes/a/.teamrig/pane.json' }
/** Each block as its key and its rows' words. */
const words = (blocks: Block[]): [string, string[]][] => blocks.map(block => [block.key, block.rows.map(row => row.spans.map(span => span.text).join(''))])

describe('setupBlocks', () => {
  test('with no team on the machine, it says why, then installing teamrig, making a team and naming a register', () => {
    expect(words(setupBlocks({ setup: SETUP, problem: null }))).toEqual([
      ['setup-head', ['teamrig is not set up for this project']],
      ['setup-why', ['No .teamrig.json in C:/w/app or a folder above it, and no team named by $TEAMRIG_TEAM.']],
      ['setup-install', [`1. Install teamrig, if it is not: ${INSTALL_LINES[0]}, then ${INSTALL_LINES[1]}.`]],
      [
        'setup-team',
        ['2. New team: ask Claude here to set up a team for the work, or run /teamrig:team-setup. It proposes the sessions, then makes the team and ties this project to it.'],
      ],
      ['setup-pane', ['3. Tasks kept outside teamrig: name tasksDir and inboxDir in C:/Homes/a/.teamrig/pane.json.']],
      ['setup-after', ['The pane looks again every few seconds and lists the tasks once a team is found.']],
    ])
  })

  test('with teams on the machine, it leaves out the install and offers to join one by the pointer file', () => {
    const keys = words(setupBlocks({ setup: { ...SETUP, teams: ['ops', 'web'] }, problem: null }))
    expect(keys.map(([key]) => key)).toEqual(['setup-head', 'setup-why', 'setup-team', 'setup-join', 'setup-pane', 'setup-after'])
    expect(keys[3]).toEqual(['setup-join', ['2. Join a team: write {"team": "<id>"} to C:/w/app/.teamrig.json. Teams on this machine: ops, web.']])
  })

  test('a problem the last look found is a warning over the steps; the text to type and the paths are colored', () => {
    const blocks = setupBlocks({ setup: SETUP, problem: 'C:/w/app/.teamrig.json is not JSON; expected {"team": "<id>"}' })
    expect(words(blocks)[2]).toEqual(['setup-problem', ['WARN C:/w/app/.teamrig.json is not JSON; expected {"team": "<id>"}']])
    expect(blocks[2]?.rows[0]?.spans[0]?.color).toBe('warning')
    const coded = blocks.flatMap(block => block.rows.flatMap(row => row.spans.filter(span => span.color === 'suggestion').map(span => span.text)))
    expect(coded).toEqual([...INSTALL_LINES, '/teamrig:team-setup', 'tasksDir', 'inboxDir', 'C:/Homes/a/.teamrig/pane.json'])
  })
})
