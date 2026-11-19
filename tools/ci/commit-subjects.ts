import { readCommits } from '../lib/commits.ts';
import { EXIT_CLEAN, EXIT_FINDINGS } from '../lib/exit.ts';
import { GitError, type Git } from '../lib/git.ts';
import type { Revisions } from './github-range.ts';

/**
 * The commit types a subject may start with. The release workflow (release-please) reads them from main's log:
 * a `feat` raises the minor, a `fix` or `perf` the patch, a `!` after the type or area marks a change that breaks
 * how people use the pane, and the rest raise nothing on their own.
 */
export const COMMIT_TYPES = ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'build', 'ci', 'chore', 'revert'] as const;

const SUBJECT = /^(?<type>[a-z]+)(?:\((?<area>[\w./-]+)\))?!?: \S/;
const TYPED = new Set<string>(COMMIT_TYPES);

/** How to reword a commit that is already in a branch: the one fix a contributor needs, said once. */
export const REWORD_HELP =
  'reword it as <type>(<area>): <what>, such as "fix(work): ..." or "docs: ...", the area optional; ' +
  'for the last commit `git commit --amend`, for an older one `git rebase -i <base>` and mark it reword, then push the branch again with --force-with-lease';

/** What is wrong with a subject, or null when release-please can read it. */
export function subjectProblem(subject: string): string | null {
  const match = SUBJECT.exec(subject);
  const type = match?.groups?.['type'];
  if (type === undefined) return 'it does not start with <type>: or <type>(<area>):';
  if (!TYPED.has(type)) return `"${type}" is no commit type; use one of ${COMMIT_TYPES.join(', ')}`;
  return null;
}

export interface CommitSubjectsDeps {
  readonly git: Git;
  readonly out: (line: string) => void;
}

/** The first line of a commit message: the subject release-please reads. */
function subjectOf(message: string): string {
  return message.split(/\r?\n/, 1)[0] ?? '';
}

/**
 * Fails each commit in base..head whose subject is no Conventional Commit, since the release workflow raises the
 * version from those subjects and a pull request is rebase-merged with its commits as they are. A run with no base
 * (a run by hand, as on the release pull request) checks the head commit alone.
 */
export async function checkCommitSubjects(ends: Revisions, deps: CommitSubjectsDeps): Promise<number> {
  const base = ends.base ?? `${ends.head}~1`;
  const range = `${base}..${ends.head}`;
  const commits = await readCommits(deps.git, range).catch((error: unknown) => {
    if (error instanceof GitError) throw new Error(`git cannot list the commits in ${range}`, { cause: error });
    throw error;
  });
  const wrong = commits.flatMap((commit) => {
    const subject = subjectOf(commit.message);
    const problem = subjectProblem(subject);
    return problem === null ? [] : [`  ${commit.sha.slice(0, 9)} "${subject}": ${problem}`];
  });
  if (wrong.length > 0) {
    deps.out(`commit-subjects: ${wrong.length} of ${commits.length} commit(s) in ${range} have a subject the release workflow cannot read:`);
    for (const line of wrong) deps.out(line);
    deps.out(`commit-subjects: ${REWORD_HELP}`);
    return EXIT_FINDINGS;
  }
  deps.out(`commit-subjects: ${commits.length} commit(s) in ${range}, each subject <type>(<area>): <what>`);
  return EXIT_CLEAN;
}
