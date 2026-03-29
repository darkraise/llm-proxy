export function Logo({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      fill="none"
      width={size}
      height={size}
      className={className}
    >
      <path
        d="M24 48 Q88 48, 128 128"
        stroke="currentColor" strokeOpacity="0.50" strokeWidth="16" strokeLinecap="round"
      />
      <path
        d="M24 128 L128 128"
        stroke="currentColor" strokeOpacity="0.65" strokeWidth="16" strokeLinecap="round"
      />
      <path
        d="M24 208 Q88 208, 128 128"
        stroke="currentColor" strokeOpacity="0.50" strokeWidth="16" strokeLinecap="round"
      />
      <circle cx="128" cy="128" r="22" fill="currentColor" />
      <circle cx="128" cy="128" r="10" fill="var(--logo-inner, white)" />
      <path
        d="M150 128 L224 128"
        stroke="currentColor" strokeWidth="18" strokeLinecap="round"
      />
      <circle cx="224" cy="128" r="12" fill="currentColor" />
    </svg>
  )
}
