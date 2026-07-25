import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost";
}

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  const base =
    "rounded-full px-6 py-3 text-sm font-semibold transition-transform duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40 disabled:pointer-events-none";
  const variantClass =
    variant === "primary"
      ? "text-[#1a1206] shadow-[0_8px_20px_-8px_rgba(203,155,62,0.55)] hover:-translate-y-0.5"
      : "border hover:-translate-y-0.5";

  return (
    <button
      {...props}
      className={`${base} ${variantClass} ${className}`}
      style={{
        background: variant === "primary" ? "linear-gradient(180deg, var(--gold-bright), var(--gold))" : "transparent",
        borderColor: variant === "ghost" ? "var(--hairline)" : undefined,
        color: variant === "ghost" ? "var(--ink)" : undefined,
        outlineColor: "var(--gold-bright)",
        ...props.style,
      }}
    />
  );
}
