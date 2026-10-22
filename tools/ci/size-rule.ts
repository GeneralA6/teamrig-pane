import { EXIT_CLEAN, EXIT_FINDINGS } from '../lib/exit.ts';
import type { Git } from '../lib/git.ts';
import { describeLargeCommits, largeCommits, readCommitStats, type CommitSizeRule } from './commit-size.ts';
import type { Revisions } from './github-range.ts';

export interface SizeRuleDeps {
  readonly git: Git;
  readonly rule: CommitSizeRule;
  readonly out: (line: string) => void;
}

/**
 * The small-commits rule over the commits in base..head, the one teamrig's push guard applies: fails each commit over
 * the rule's changed non-test lines or files whose message gives no reason line. A new branch has no base, so there
 * is nothing to compare with.
 */
export async function checkCommitSizes(ends: Revisions, deps: SizeRuleDeps): Promise<number> {
  if (ends.base === undefined) {
    deps.out('size-rule: no base commit to compare with (a new branch), nothing to check');
    return EXIT_CLEAN;
  }
  const commits = await readCommitStats(deps.git, ends.base, ends.head);
  const large = largeCommits(commits, deps.rule);
  if (large.length > 0) {
    deps.out(`size-rule: ${describeLargeCommits(large, deps.rule)}`);
    return EXIT_FINDINGS;
  }
  deps.out(
    `size-rule: ${commits.length} commit(s) in ${ends.base}..${ends.head}, none over ${deps.rule.maxLines} changed non-test lines or ${deps.rule.maxFiles} non-test files without a "${deps.rule.largeCommitTrailer}: <reason>" line`,
  );
  return EXIT_CLEAN;
}
