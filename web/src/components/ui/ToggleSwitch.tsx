export function ToggleSwitch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2"
    >
      {label && <span className="text-sm text-text-secondary">{label}</span>}
      <div className={`relative w-9 h-5 rounded-[10px] transition-colors ${checked ? 'bg-accent' : 'bg-[rgba(255,255,255,0.1)]'}`}>
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
      </div>
    </button>
  );
}
