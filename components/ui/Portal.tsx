import React from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders children into <body>, outside whatever stacking context the caller
 * happens to sit in.
 *
 * A `z-index` only ranks an element against its siblings inside the nearest
 * stacking context — it does not compete globally. The Review page's <main>
 * is `relative z-10`, so an overlay rendered inside it is capped at that
 * layer no matter how large its own z-index is, and the bottom nav bar
 * (`z-40`, a sibling of <main>) paints over all of it. That is what hid the
 * bottom of the row action sheet: the Cancel button was rendered, just buried
 * under the nav bar.
 *
 * Escaping to <body> is the fix rather than raising the overlay's z-index,
 * which cannot work from inside the capped context, or lowering the nav bar's,
 * which would only move the collision somewhere else.
 */
const Portal: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
};

export default Portal;
