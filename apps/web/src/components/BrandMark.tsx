interface BrandMarkProps {
  className?: string;
}

export function BrandMark({ className }: BrandMarkProps) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={["brand-logo", className].filter(Boolean).join(" ")}
      decoding="async"
      height={512}
      src="/aether-logo.png"
      width={512}
    />
  );
}
