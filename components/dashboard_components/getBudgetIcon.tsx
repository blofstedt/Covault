
const iconProps = {
  className: 'w-5 h-5',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
} as const;

export const getBudgetIcon = (name: string) => {
  const lower = name.toLowerCase();

  if (lower.includes('housing')) {
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    );
  }

  if (lower.includes('groceries')) {
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <path d="M2.27 21.7s9.87-3.5 12.73-6.36a4.5 4.5 0 0 0-6.36-6.37L2.27 21.7z" />
        <path d="M18.4 5.6 19.1 3.5" />
        <path d="M17 10.4 18.4 11.8" />
        <path d="M13.6 17 15 18.4" />
        <path d="M18.4 5.6 20.5 4.9" />
        <path d="M18.4 5.6 19.8 7" />
      </svg>
    );
  }

  if (lower.includes('transport')) {
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 13.1V16c0 .6.4 1 1 1h2" />
        <circle cx="7" cy="17" r="2" />
        <path d="M9 17h6" />
        <circle cx="17" cy="17" r="2" />
      </svg>
    );
  }

  if (lower.includes('dining') || lower.includes('leisure')) {
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" />
        <path d="M8 14s1.5 2 4 2 4-2 4-2" />
        <line x1="9" y1="9" x2="9.01" y2="9" />
        <line x1="15" y1="9" x2="15.01" y2="9" />
      </svg>
    );
  }

  if (lower.includes('utilities')) {
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <path d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    );
  }

  if (lower.includes('shopping')) {
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <path d="M6 2 3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
        <path d="M3 6h18" />
        <path d="M16 10a4 4 0 01-8 0" />
      </svg>
    );
  }

  if (lower.includes('personal')) {
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <circle cx="12" cy="7" r="5" />
        <path d="M4 22c0-4.4 3.6-8 8-8s8 3.6 8 8" />
      </svg>
    );
  }

  if (lower.includes('travel')) {
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <path d="M17.8 19.2 16 11l3.5-3.5a2.5 2.5 0 10-3.5-3.5L12.5 7.5 4.3 5.7a1 1 0 00-.9 1.7l6.1 4.3-2.6 2.6-3.4-.6a1 1 0 00-.8 1.7l2.6 2.1 2.1 2.6a1 1 0 001.7-.8l-.6-3.4 2.6-2.6 4.3 6.1a1 1 0 001.7-.9z" />
      </svg>
    );
  }

  if (lower.includes('services')) {
    return (
      <svg {...iconProps} viewBox="0 0 24 24">
        <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
        <line x1="12" y1="18" x2="12.01" y2="18" />
      </svg>
    );
  }

  return (
    <svg {...iconProps} viewBox="0 0 24 24">
      <path d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
    </svg>
  );
};
