import { SwitchBase } from './Switch'

export function ToggleSwitch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-sm text-text-secondary">{label}</span>}
      <SwitchBase checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
