/**
 * Something wrong with a project, as this extension
 * hands it to the editor's PROBLEMS panel.
 *
 * The panel is the one surface that shows what is
 * wrong with files nobody has open, which is most
 * of them: the code-behind a workflow names, the
 * documents in a project with one canvas showing.
 * So everything the rules, the code-behind scan and
 * the compiler find comes through here.
 *
 * `message` is whoever found it word for word.
 * These sentences are written to be read by the
 * person looking at the block they are about — they
 * already name what they are about, in the same
 * wording an agent driving the control plane sees —
 * and a second wording composed here would be a
 * second thing to keep true.
 */
export type Problem = {
  /** The file it belongs to, absolute. */
  file: string;

  /** What was found, as it was written. */
  message: string;

  /** Fixed by whichever rule found it, never by the
   *  document it was found in. */
  severity: 'error' | 'warning';

  /** The rule, when a rule found it, so a reader
   *  can look it up. */
  code?: string;
};
