import type { ButtonProps } from './Button.js';

/**
 * The Button the compiler refuses to draw.
 *
 * A bordered button in neutral ink is a fifth look
 * this system does not have: the bordered one is the
 * outline, which is that border with the product's
 * own ink in it. Saying so in the props is what
 * stops the fifth look appearing by accident, since
 * a sweep over the source can only see the pairing
 * where somebody wrote both words out.
 */

export const outline: ButtonProps = {
  variant: 'secondary',
  ink: 'brand',
  children: '',
};

// @ts-expect-error a bordered Button has the
// product's ink in it or it is not one of the looks.
export const neutral: ButtonProps = {
  variant: 'secondary',
  children: '',
};
