// The tasks view in a project teamrig is not set up for (hooks/setup-rows.ts): why, a problem the last look found,
// then the one step: set up a team with team-setup, installing teamrig first while no team is on the machine.
import { describe, expect, test } from 'claude-code/testing'
import type { ProjectSetup } from '../types'
import type { Block } from '../hooks/rows'
import { INSTALL_LINES, setupBlocks } from '../hooks/setup-rows'

const SETUP: ProjectSetup = { project: 'C:/w/app', teams: [] }
/** Each block as its key and its rows' words. */
const words = (blocks: Block[]): [string, string[]][] => blocks.map(block => [block.key, block.rows.map(row => row.spans.map(span => span.text).join(''))])
const TEAM_SETUP = 'set up a team: ask Claude here, or run /teamrig:team-setup. It proposes the sessions, then makes the team and ties this project to it.'

describe('setupBlocks', () => {
  test('with no team on the machine, it says why, then the one step: install teamrig, then set up a team', () => {
    expect(words(setupBlocks({ setup: SETUP, problem: null }))).toEqual([
      ['setup-head', ['teamrig is not set up for this project']],
      ['setup-why', ['No .teamrig.json in C:/w/app or a folder above it, and no team named by $TEAMRIG_TEAM.']],
      ['setup-team', [`Install teamrig if it is not (${INSTALL_LINES[0]}, then ${INSTALL_LINES[1]}), then ${TEAM_SETUP}`]],
      ['setup-after', ['The pane looks again every few seconds and lists the tasks once a team is found.']],
    ])
  })

  test('with teams on the machine, teamrig is there: the step only sets up a team', () => {
    const keys = words(setupBlocks({ setup: { ...SETUP, teams: ['ops', 'web'] }, problem: null }))
    expect(keys.map(([key]) => key)).toEqual(['setup-head', 'setup-why', 'setup-team', 'setup-after'])
    expect(keys[2]).toEqual([
      'setup-team',
      ['Set up a team: ask Claude here, or run /teamrig:team-setup. It proposes the sessions, then makes the team and ties this project to it.'],
    ])
  })

  test('a problem the last look found is a warning over the step; the text to type is colored', () => {
    const blocks = setupBlocks({ setup: SETUP, problem: 'C:/w/app/.teamrig.json is not JSON; expected {"team": "<id>"}' })
    expect(words(blocks)[2]).toEqual(['setup-problem', ['WARN C:/w/app/.teamrig.json is not JSON; expected {"team": "<id>"}']])
    expect(blocks[2]?.rows[0]?.spans[0]?.color).toBe('warning')
    const coded = blocks.flatMap(block => block.rows.flatMap(row => row.spans.filter(span => span.color === 'suggestion').map(span => span.text)))
    expect(coded).toEqual([...INSTALL_LINES, '/teamrig:team-setup'])
  })
})
