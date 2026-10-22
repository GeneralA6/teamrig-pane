// The tasks view in a project teamrig is not set up for (setup.ts): what is missing, the problem the last look
// found, then the one step to take: set up a team with teamrig's team-setup, which makes the team and ties the
// project to it, installing teamrig first while no team is on the machine. The pane picks the register up
// once a team is found (setup.ts), which the last line says.
import { TEAM_POINTER } from './places'
import { single, type Block, type Span } from './rows'
import type { SetupView } from '../types'

/** teamrig's marketplace and plugin, as its README installs them. */
export const INSTALL_LINES = ['claude plugin marketplace add GeneralA6/teamrig', 'claude plugin install teamrig@teamrig'] as const

/** Text to type or a path to write, in the theme's suggestion color. */
const code = (text: string): Span => ({ text, color: 'suggestion' })

/**
 * How the step opens. No team on the machine likely means no teamrig, whose team-setup the step names, so it
 * installs teamrig first.
 */
function stepOpening(hasTeams: boolean): Span[] {
  if (hasTeams) return [{ text: 'Set up a team: ask Claude here, or run ' }]
  return [
    { text: 'Install teamrig if it is not (' },
    code(INSTALL_LINES[0]),
    { text: ', then ' },
    code(INSTALL_LINES[1]),
    { text: '), then set up a team: ask Claude here, or run ' },
  ]
}

export function setupBlocks(view: SetupView): Block[] {
  const { project, teams } = view.setup
  const problem = view.problem === null ? [] : [single('setup-problem', [{ text: `WARN ${view.problem}`, color: 'warning' }], { text: '  ' })]
  return [
    single('setup-head', [{ text: 'teamrig is not set up for this project', bold: true }]),
    single('setup-why', [{ text: `No ${TEAM_POINTER} in ${project} or a folder above it, and no team named by $TEAMRIG_TEAM.`, dim: true }]),
    ...problem,
    single('setup-team', [
      ...stepOpening(teams.length > 0),
      code('/teamrig:team-setup'),
      { text: '. It proposes the sessions, then makes the team and ties this project to it.' },
    ]),
    single('setup-after', [{ text: 'The pane looks again every few seconds and lists the tasks once a team is found.', dim: true }]),
  ]
}
