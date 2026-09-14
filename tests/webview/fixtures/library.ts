/**
 * What the graph library paints when nothing tells
 * it otherwise.
 *
 * Its stylesheet declares a default for every part
 * it draws and reads that default whenever the
 * un-suffixed variable beside it is undeclared. The
 * defaults are a light diagramming palette chosen
 * against a white page, so a panel that reads one
 * is a panel wearing somebody else's theme in the
 * middle of the editor's.
 *
 * Both appearances are here, because the library
 * publishes a dark set too and either one landing
 * is the same failure.
 */
export const LIBRARY_COLOURS: readonly string[] = [
  // A handle.
  'rgb(26, 25, 43)',
  'rgb(190, 190, 190)',
  // An edge.
  'rgb(177, 177, 183)',
  'rgb(62, 62, 62)',
  // A selected edge.
  'rgb(85, 85, 85)',
  'rgb(114, 114, 114)',
  // A background dot.
  'rgb(145, 145, 154)',
];
