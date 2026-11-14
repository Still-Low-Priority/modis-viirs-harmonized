// Inline SVG icons for the map controls (stroke uses currentColor).

interface IconProps {
  size?: number
}

export function LayersIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 3 2 8.5 12 14l10-5.5L12 3Z" />
      <path d="m2 13.5 10 5.5 10-5.5" />
    </svg>
  )
}

export function ChevronIcon({ size = 12, up = false }: IconProps & { up?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={up ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
    </svg>
  )
}
