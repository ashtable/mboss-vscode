import type { Page } from '@playwright/test';

/**
 * Readers that ask one question of a whole page.
 *
 * More than one spec reads them, and Playwright
 * refuses a spec that imports another, so they live
 * beside the specs rather than in one.
 */

/**
 * How long everything on the page would take, in
 * milliseconds.
 *
 * Every element rather than the few that are known
 * to move: the question is whether anything at all
 * is still going, and a rule nobody remembered is
 * exactly the one that keeps moving.
 *
 * A computed duration is a comma-separated list
 * wherever a rule set more than one, so each is
 * read on its own.
 */
export function durationsOf(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const milliseconds = (list: string) =>
      list.split(',').map((one) => {
        const value = Number.parseFloat(one);

        return one.trim().endsWith('ms') ? value : value * 1000;
      });

    return [...document.querySelectorAll('*')].flatMap((element) => {
      const style = getComputedStyle(element);

      return [
        ...milliseconds(style.animationDuration),
        ...milliseconds(style.transitionDuration),
      ];
    });
  });
}

/** What a duration collapses to when somebody asked
 *  for less movement: not zero, because a
 *  transition that never starts also never ends. */
export const STILL = 0.01;
