import React from 'react';

/**
 * The shield mark, shown beside the name while this vault is covering another
 * category's overspending.
 *
 * An inline SVG rather than an icon package because that is how every glyph in
 * this app is drawn — see `getBudgetIcon`, which uses the same stroke weight
 * and rounded caps. Sized under the text line so the row's height cannot move.
 */
const ShieldMark: React.FC<{ color: string; inDisc?: boolean }> = ({
  color,
  inDisc = false,
}) => (
  <svg
    // Two sizes, one shape: the mark beside the name, and the same mark filling
    // NoticeModal's icon disc, where it is drawn at the weight that modal's own
    // default icon uses so it does not read as heavier than every other notice.
    className={inDisc ? 'w-8 h-8' : 'w-3 h-3 shrink-0 opacity-70'}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={inDisc ? 2 : 2.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 3l7 3v6c0 4.2-2.9 7.5-7 9-4.1-1.5-7-4.8-7-9V6l7-3z" />
  </svg>
);


export default ShieldMark;
