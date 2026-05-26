interface FluxLogoMarkProps {
  size?: number;
}

export function FluxLogoMark({ size = 24, color = "white" }: FluxLogoMarkProps & { color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M3 8.5H15.5" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M12.5 5.5L16 8.5L12.5 11.5" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 15.5H8.5" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeOpacity="0.6" />
      <path d="M11.5 12.5L8 15.5L11.5 18.5" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.6" />
    </svg>
  );
}

interface FluxLogoBadgeProps {
  size?: number;
}

export function FluxLogoBadge({ size = 48 }: FluxLogoBadgeProps) {
  return (
    <div
      className="flex items-center justify-center rounded-2xl"
      style={{
        width: size,
        height: size,
        background: "linear-gradient(135deg, #A855F730 0%, #7C3AED18 100%)",
        border: "1px solid #A855F750",
        boxShadow: "0 0 28px #A855F725, inset 0 1px 0 #A855F730",
      }}
    >
      <FluxLogoMark size={Math.round(size * 0.5)} />
    </div>
  );
}
