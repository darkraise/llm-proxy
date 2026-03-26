import { useToast } from './Toast';

interface ModelNameProps {
  name: string;
  className?: string;
}

export function ModelName({ name, className = '' }: ModelNameProps) {
  const { showToast } = useToast();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Don't trigger parent click handlers (like card/row click)
    navigator.clipboard.writeText(name).then(() => {
      showToast(`Copied: ${name}`);
    });
  };

  return (
    <span
      onClick={handleClick}
      className={`font-mono cursor-pointer hover:text-accent-light transition-colors ${className}`}
      title="Click to copy"
    >
      {name}
    </span>
  );
}
