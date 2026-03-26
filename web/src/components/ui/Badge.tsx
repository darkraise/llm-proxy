import type { ReactNode } from 'react';

type BadgeVariant = 'accent' | 'success' | 'warning' | 'error' | 'neutral';

const variantClasses: Record<BadgeVariant, string> = {
  accent: 'bg-accent-muted text-accent-light',
  success: 'bg-[rgba(82,196,26,0.12)] text-success',
  warning: 'bg-[rgba(250,173,20,0.12)] text-warning',
  error: 'bg-[rgba(248,81,73,0.12)] text-error',
  neutral: 'bg-[rgba(255,255,255,0.05)] text-text-secondary',
};

export function Badge({ variant = 'neutral', children }: { variant?: BadgeVariant; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-[5px] px-2.5 py-0.5 text-[11px] font-medium ${variantClasses[variant]}`}>
      {children}
    </span>
  );
}
