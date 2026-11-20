// What the pane's state (../types PaneState) holds before anything is read or pressed, and the values its readers
// write when there is nothing to read. Any front end starts from INITIAL_STATE: the Claude Code dock gives each key's
// value to its atom as the default (register.tsx), a front end with no engine, and the tests, to a MemoryStore
// (pane-store.ts).
import type {
  FilePages,
  LogConversation,
  LogList,
  LogPage,
  MeetingAnswer,
  MeetingAsked,
  MeetingsView,
  OwnerAct,
  PageDetails,
  PaneState,
  RequirementProblem,
  SessionAnswer,
  SetupView,
  Snapshot,
  StatsChoice,
  StatsListPick,
  StatsView,
  TeamView,
} from '../types'
import { AT_TOP } from './body-scroll'
import { EMPTY_CHANGES, NOTHING_KNOWN } from './changes'
import { DEFAULT_FOCUS, DEFAULT_REGISTER, TimeZone, type StatsRange } from './core/read/index'
import { NO_DIFFS } from './diff'
import { FIRST_FIELD, NO_LANDINGS } from './find-field'
import { AT_LIST } from './nav'
import { NO_COPIES } from './outside-copies'
import { NO_SPEND } from './ranking'
import { NOTHING_EXPANDED, NOTHING_FOLDED } from './rows'
import { NO_TASK_COUNTS } from './task-counts'
import { NO_GOAL_RANKS } from './tree-goals'

/** The snapshot before the first read of the register. */
export const EMPTY_SNAPSHOT: Snapshot = {
  tasks: [],
  area: null,
  areaSource: null,
  team: null,
  areaName: null,
  leads: null,
  work: [],
  unreadInbox: null,
  inbox: [],
  problem: null,
  notPickedUpAfterHours: DEFAULT_REGISTER.check.notPickedUpAfterHours,
  timeZone: TimeZone.UTC.name,
  ownerSource: DEFAULT_REGISTER.ownerSource,
  focus: DEFAULT_FOCUS,
  goals: NO_GOAL_RANKS,
  spend: NO_SPEND,
  ownerCards: {},
  taskCounts: NO_TASK_COUNTS,
  elsewhere: [],
  now: 0,
}

/** The Log view's list while its first read runs, in a project with no team, and in a team whose config cannot be read. */
export const LOG_READING: LogList = { kind: 'reading' }
export const NO_TEAM_LOG: LogList = { kind: 'no-team' }
export const NO_CONFIG_LOG: LogList = { kind: 'no-config' }
/** The Log view at its list, no conversation's page open. */
export const AT_LOG_LIST: LogPage | null = null
/** No conversation before the one of now, for the band (previous-conversation.ts). */
export const NO_PREVIOUS: LogConversation | null = null
/** The pane lacks nothing (requirements.ts). */
const NOTHING_MISSING: RequirementProblem[] = []
/** A register is found: the pane shows no setup (setup.ts). */
export const NOT_SETTING_UP: SetupView | null = null
const NO_PAGES: PageDetails = {}
export const NO_FILES: FilePages = {}
/** The Teams tab's tree (team-source.ts) while its first read runs, and in a project with no team. */
export const TEAM_READING: TeamView = { kind: 'reading' }
export const NO_TEAM_TREE: TeamView = { kind: 'no-team' }
/** No row flipped against its default: the Teams tab's nodes, the open meetings, the Stats sections, the Done page's rows. */
const NOTHING_TOGGLED: readonly string[] = []
/** The Meetings view's list (meetings.ts) while its first read runs, and in a project with no team. */
const MEETINGS_READING: MeetingsView = { kind: 'reading' }
export const NO_TEAM_MEETINGS: MeetingsView = { kind: 'no-team' }
export const NO_MEETING_ANSWER: MeetingAnswer | null = null
export const NO_MEETING_ASKED: MeetingAsked | null = null
/** The Stats tab's numbers (stats-source.ts) while their first fold runs, and in a project with no team. */
const STATS_READING: StatsView = { kind: 'reading' }
export const NO_TEAM_STATS: StatsView = { kind: 'no-team' }
/** The Stats tab folds the whole tree, over the last 7 days, until a press on its scope or range row picks others. */
const TREE_SCOPE: StatsChoice = { kind: 'tree' }
const FIRST_RANGE: StatsRange = '7d'
/** The Stats tab shows its numbers, no Health count's tasks listed in their place. */
export const NO_STATS_LIST: StatsListPick | null = null
/** The Stats tab shows from its switch, no Teams tab row for back to land on. */
export const NO_STATS_FROM: string | null = null
/** No press on a Teams tab session row answered yet (session-acts.ts). */
export const NO_ANSWER: SessionAnswer | null = null
/** No owner's Note or Next stands on a task's card (owner-acts.ts). */
export const NO_ACT: OwnerAct | null = null

/** Every key of the pane's state as a pane starts with it. */
export const INITIAL_STATE: PaneState = {
  snapshot: EMPTY_SNAPSHOT,
  mode: 'mine',
  expanded: NOTHING_EXPANDED,
  tasksFolded: NOTHING_FOLDED,
  size: 'open',
  view: 'tasks',
  changes: EMPTY_CHANGES,
  known: NOTHING_KNOWN,
  diffs: NO_DIFFS,
  copies: NO_COPIES,
  logList: LOG_READING,
  logPage: AT_LOG_LIST,
  previousConversation: NO_PREVIOUS,
  requirements: NOTHING_MISSING,
  filter: null,
  nav: AT_LIST,
  pages: NO_PAGES,
  filePages: NO_FILES,
  findField: FIRST_FIELD,
  ring: NO_LANDINGS,
  banner: false,
  previousOpen: false,
  setup: NOT_SETTING_UP,
  bodyScroll: AT_TOP,
  teamTree: TEAM_READING,
  teamToggled: NOTHING_TOGGLED,
  meetings: MEETINGS_READING,
  meetingsOpen: NOTHING_TOGGLED,
  meetingAnswer: NO_MEETING_ANSWER,
  meetingAsked: NO_MEETING_ASKED,
  sessionAnswer: NO_ANSWER,
  ownerAct: NO_ACT,
  stats: STATS_READING,
  statsScope: TREE_SCOPE,
  statsRange: FIRST_RANGE,
  statsList: NO_STATS_LIST,
  statsFrom: NO_STATS_FROM,
  statsToggled: NOTHING_TOGGLED,
  doneToggled: NOTHING_TOGGLED,
}
