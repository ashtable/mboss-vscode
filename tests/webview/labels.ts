import { expect, type Locator } from '@playwright/test';

/**
 * That a property row reads label, then value.
 *
 * A value with its caption under it makes a person
 * read the number before they know what it counts,
 * and a column of those is a column of numbers with
 * the words scattered between them. So a row is held
 * to four things, measured on the page rather than
 * read off the markup, because a stylesheet can undo
 * any order the markup has:
 *
 * - the label comes first in the document, which is
 *   the order a screen reader says them in;
 * - it ends before the value starts;
 * - its first line is the value's first line — its
 *   top falls inside the value's first line box, so
 *   a label that wraps still starts beside the value
 *   rather than above it;
 * - nothing else in the row sits under the value,
 *   except the note about what was typed into it.
 *
 * Shared, because every surface that sets a property
 * out in a row is held to the same four, and a copy
 * per spec is how one of them quietly drops a rule.
 */
export async function labelBeforeValue(row: Locator): Promise<void> {
  await expect(row.locator(':scope > .property-label')).toHaveCount(1);
  await expect(row.locator(':scope > .value')).toHaveCount(1);

  const read = await row.evaluate((element) => {
    const label = element.querySelector(':scope > .property-label')!;
    const value = element.querySelector(':scope > .value')!;
    const named = label.getBoundingClientRect();
    const held = value.getBoundingClientRect();

    // The value's first line: the first box its
    // content draws — a control's own box, or a line
    // of text — and no shorter than one line of the
    // value's own type, since a run of text draws a
    // box only as tall as its glyphs.
    const contents = document.createRange();
    contents.selectNodeContents(value);

    const first = contents.getClientRects()[0];
    const line = Number.parseFloat(getComputedStyle(value).lineHeight);
    const lineBottom = Math.max(
      first === undefined ? held.top : first.bottom,
      held.top + (Number.isNaN(line) ? 0 : line),
    );

    const under = [...element.querySelectorAll('*')]
      .filter(
        (one) =>
          !label.contains(one) &&
          !value.contains(one) &&
          one.closest('.field-note') === null,
      )
      .filter((one) => one.getBoundingClientRect().top >= held.bottom)
      .map((one) => one.outerHTML.slice(0, 80));

    return {
      labelFirst: Boolean(
        label.compareDocumentPosition(value) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      labelRight: named.right,
      labelTop: named.top,
      valueLeft: held.left,
      valueTop: held.top,
      lineBottom,
      under,
      text: (label.textContent ?? '').trim(),
    };
  });

  const which = `the row labelled "${read.text}"`;

  expect(read.labelFirst, which).toBe(true);
  expect(read.labelRight, which).toBeLessThanOrEqual(read.valueLeft);

  // Half a pixel either way: two boxes laid out on
  // one baseline land a fraction apart.
  expect(read.labelTop, which).toBeGreaterThanOrEqual(read.valueTop - 0.5);
  expect(read.labelTop, which).toBeLessThanOrEqual(read.lineBottom);

  expect(read.under, which).toEqual([]);
}
