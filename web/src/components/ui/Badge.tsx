import type { ReactNode } from "react";

type BadgeVariant = "accent" | "success" | "warning" | "error" | "neutral";

const variantClasses: Record<BadgeVariant, string> = {
  accent: "bg-accent-muted text-accent-light",
  success: "bg-[rgba(82,196,26,0.12)] text-success",
  warning: "bg-[rgba(250,173,20,0.12)] text-warning",
  error: "bg-[rgba(248,81,73,0.12)] text-error",
  neutral: "bg-[rgba(255,255,255,0.05)] text-text-secondary",
};

export function Badge({
  variant = "neutral",
  children,
}: {
  variant?: BadgeVariant;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded px-2.5 py-0.5 text-xs font-medium ${variantClasses[variant]}`}
    >
      {children}
    </span>
  );
}

const providerColors: Record<string, string> = {
  google: "bg-[rgba(66,133,244,0.12)] text-[#5b9cf5]",
  groq: "bg-[rgba(244,147,40,0.12)] text-[#f4932a]",
  openrouter: "bg-[rgba(110,207,176,0.12)] text-[#6ecfb0]",
  cerebras: "bg-[rgba(229,75,75,0.12)] text-[#e54b4b]",
  mistral: "bg-[rgba(255,122,0,0.12)] text-[#ff7a00]",
  github: "bg-[rgba(200,200,210,0.12)] text-[#c8c8d2]",
  ollama: "bg-[rgba(255,255,255,0.08)] text-[#e0e0e8]",
  "openai-compatible": "bg-[rgba(16,163,127,0.12)] text-[#10a37f]",
};

export function ProviderBadge({ provider }: { provider: string }) {
  const colors =
    providerColors[provider] ??
    "bg-[rgba(255,255,255,0.05)] text-text-secondary";
  return (
    <span
      className={`inline-flex items-center justify-center rounded px-2.5 pt-0.5 pb-1.5 text-xs font-medium ${colors}`}
    >
      {provider}
    </span>
  );
}
