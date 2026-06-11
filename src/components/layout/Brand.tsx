/* eslint-disable @next/next/no-img-element */
export function BrandMark({ size = 24 }: { size?: number }) {
  // Pallisade emblem (public/pallisade_emblem.svg)
  return (
    <img
      src="/pallisade_emblem.svg"
      alt="Pallisade"
      width={size}
      height={size}
      style={{ display: "block", objectFit: "contain" }}
    />
  );
}

export function BrandWordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark size={26} />
      <div className="leading-none">
        <div className="text-[0.92rem] font-semibold tracking-[0.02em] text-[var(--color-ink)]">
          Pallisade<span className="text-[var(--color-accent)]"> OS</span>
        </div>
        <div className="text-[0.62rem] tracking-[0.16em] uppercase text-[var(--color-dim)] mt-1">
          Operating System
        </div>
      </div>
    </div>
  );
}
