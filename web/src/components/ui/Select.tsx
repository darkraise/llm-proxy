import { useState, useRef, useEffect, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface SelectOption {
  value: string;
  label: ReactNode;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  className?: string;
  placeholder?: string;
}

export function Select({ value, onChange, options, className = '', placeholder }: SelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="input w-full flex items-center justify-between gap-2 text-left"
      >
        <span className={`truncate ${selected ? 'text-text-primary' : 'text-text-muted'}`}>
          {selected?.label ?? placeholder ?? 'Select...'}
        </span>
        <ChevronDown size={14} className={`text-text-muted flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-60 overflow-auto bg-surface-overlay border border-border rounded-lg shadow-lg py-1">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                opt.value === value
                  ? 'bg-accent-muted text-accent-light'
                  : 'text-text-primary hover:bg-[rgba(255,255,255,0.04)]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
