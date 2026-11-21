/**
 * The dedicated UI as one file a release carries: the emitted scripts, by path, in a JSON document. `teamrig ui`
 * fetches it, holds its bytes to a sha256 its own release pins, and only then writes the files out. A JSON document
 * rather than a tar or a zip, so that neither side needs a package or a system tool to pack or unpack it, and so the
 * same sources give the same bytes on every machine: the files go in path order and nothing of the build's time or
 * host goes in. Every path is checked here as the reader must check it again: the reader trusts no archive.
 */

import { createHash } from 'node:crypto';

/** The shape below; raised when a reader of the old one could not read the new one. */
export const ARCHIVE_FORMAT = 1;

/** The name the release carries the archive under. */
export const ARCHIVE_NAME = 'teamrig-ui.json';

export interface ArchiveFile {
  /** From the archive's root, `/`-separated. */
  readonly path: string;
  readonly text: string;
}

export interface UiArchive {
  readonly format: typeof ARCHIVE_FORMAT;
  /** The pane release the scripts were emitted from. */
  readonly version: string;
  /**
   * The version of teamrig's public interface the scripts were written against, as `<major>.<minor>`: teamrig reads it
   * before it writes a file out, and starts no UI it does not serve.
   */
  readonly interface: string;
  /** The script `node` is started on, one of `files`. */
  readonly entry: string;
  /** In path order, by code unit. */
  readonly files: readonly ArchiveFile[];
}

/** What an archive says of itself, apart from its files. */
export type ArchiveHead = Pick<UiArchive, 'version' | 'interface' | 'entry'>;

/** `<major>.<minor>` in digits, with no sign, space or leading zero: one version has one spelling, as teamrig reads it. */
const INTERFACE_TEXT = /^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/;

/** Whether `text` names an interface version as teamrig spells one. */
export function isInterfaceText(text: string): boolean {
  return INTERFACE_TEXT.test(text);
}

/** One folder or file name: letters, digits, `_`, `-` and `.`, never starting with a dot, so never `.` or `..`. */
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/** Whether `path` stays under the folder it is unpacked into on every OS: relative, `/`-separated, each name plain. */
export function isArchivePath(path: string): boolean {
  return path.length > 0 && path.split('/').every((segment) => SEGMENT.test(segment));
}

/**
 * The archive of `files` (a path to its text). Throws, naming the path, when one could leave the folder it is
 * unpacked into, when `entry` is not among them, and when the interface version is not spelled as teamrig reads one:
 * such an archive is never written.
 */
export function archiveOf(head: ArchiveHead, files: ReadonlyMap<string, string>): UiArchive {
  const { version, entry } = head;
  if (!isInterfaceText(head.interface)) throw new Error(`not an interface version, <major>.<minor>: ${JSON.stringify(head.interface)}`);
  const paths = [...files.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const refused = paths.filter((path) => !isArchivePath(path));
  if (refused.length > 0) throw new Error(`not a path an archive may hold: ${refused.join(', ')}`);
  if (!files.has(entry)) throw new Error(`the entry ${entry} is not among the archive's files`);
  return {
    format: ARCHIVE_FORMAT,
    version,
    interface: head.interface,
    entry,
    files: paths.map((path) => ({ path, text: files.get(path) ?? '' })),
  };
}

/** The archive's bytes as text: what is written, hashed and fetched. */
export function archiveText(archive: UiArchive): string {
  return `${JSON.stringify(archive)}\n`;
}

/** The sha256 of `text` as UTF-8, in hex: what `teamrig ui` holds the fetched bytes to. */
export function sha256Of(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
