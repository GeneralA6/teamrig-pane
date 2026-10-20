// Preloaded (node --import) into each teamrig CLI run of a capture (golden.ts): fixes the Date clock (Date.now,
// new Date(), Date()) at the instant $GOLDEN_CLOCK_MS names, so the stamps teamrig writes and the times it prints are
// the same on every capture. golden.ts refuses a teamrig whose source reads a timer clock (golden-format.ts realClockReads).
import { clockAt, fixedDate, GOLDEN_CLOCK_VARIABLE } from './golden-format.ts'

globalThis.Date = fixedDate(clockAt(process.env[GOLDEN_CLOCK_VARIABLE]), Date)
