// The version of teamrig's public interface this view model was written against (T4761), as `<major>.<minor>`. The
// interface is versioned apart from teamrig and from the pane: a minor only adds documents and fields, a major
// changes what they mean. So this one version is the range a front end speaks: any teamrig serving this major at this
// minor or a later one. The dedicated UI's archive carries it (tools/ui-archive), so that teamrig can refuse a UI it
// does not serve before it starts one. Raise the minor in the change that first reads a document or a field the
// interface added in it. No imports: the archive tool loads this file under plain Node.

/** The interface version every read, act and event of this view model is written against. */
export const SPEAKS = '1.0'
