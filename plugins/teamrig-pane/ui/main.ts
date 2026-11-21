// The dedicated UI's entry, the file `node` runs: it hands the process's own streams and signals to the program
// (program.ts) and sets the exit code it answers. It has no team to read yet: it draws the empty pane, on a store
// kept in memory. Nothing is exported and nothing else lives here, since loading this file takes the terminal.
import process from 'node:process'
import { INITIAL_STATE } from '../hooks/pane-state'
import { MemoryStore } from '../hooks/pane-store'
import { NO_TEAM_FRONT, ownLook, runProgram } from './program'

process.exitCode = await runProgram({
  input: process.stdin,
  output: process.stdout,
  signals: process,
  store: new MemoryStore(INITIAL_STATE),
  front: () => NO_TEAM_FRONT,
  look: ownLook(),
  errors: process.stderr,
  // Nothing is run yet, so nothing is left to stop.
  ending: () => undefined,
})
