// components/CovaultIcon.tsx
import React from "react";

interface CovaultIconProps {
  size?: number;        // size in pixels
  rotate?: boolean;     // whether to keep the tilt
  className?: string;   // extra tailwind classes
}

const CovaultIcon: React.FC<CovaultIconProps> = ({
  size = 112,   // matches w-28 h-28
  rotate = true,
  className = ""
}) => {
  return (
    <div
      className={`
        flex items-center justify-center
        rounded-[2.5rem]
        bg-emerald-600 
        shadow-2xl shadow-emerald-500/40
        ${rotate ? "rotate-12" : ""}
        ${className}
      `}
      style={{ width: size, height: size }}
    >
      <svg
        className={`text-white ${rotate ? "-rotate-12" : ""}`}
        width={size * 0.57}     // matches w-16 within w-28
        height={size * 0.57}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="12" cy="12" r="4" />
        <path d="M12 8v1" />
        <path d="M12 15v1" />
        <path d="M8 12h1" />
        <path d="M15 12h1" />
        <path d="M12 12l2 2" />
      </svg>
    </div>
  );
};

export default CovaultIcon;
