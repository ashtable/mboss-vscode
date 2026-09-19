import type { Page } from '@playwright/test';

/**
 * What a mounted page actually paints a role.
 *
 * A custom property computes to its own tokens, so
 * reading one back hands over the mix rather than
 * the colour. A probe is what resolves it: give
 * something the role as its colour and the browser
 * works the mix out the same way it would for a rule
 * that used it.
 *
 * Asking whether the role is declared at all comes
 * first, because an undeclared property makes the
 * probe's colour invalid and the probe then inherits
 * the body's ink — a real colour, and the wrong
 * answer. Nothing declared is answered with nothing.
 */
export async function painted(
  page: Page,
  properties: readonly string[],
): Promise<string[]> {
  return page.evaluate((names) => {
    const probe = document.createElement('span');
    document.body.append(probe);

    const read = names.map((name) => {
      if (getComputedStyle(probe).getPropertyValue(name).trim() === '') {
        return '';
      }

      probe.style.color = `var(${name})`;

      return getComputedStyle(probe).color;
    });

    probe.remove();

    return read;
  }, properties);
}
