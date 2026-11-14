/**
 * Brand mark: a 3x3 block of sensor pixels with a hot centre, the way a fire
 * shows up in MODIS / VIIRS thermal data.
 */
export function Logo({ size = 24 }: { size?: number }) {
  const cells = ['#3a2a26', '#8a3324', '#3a2a26', '#c8501e', '#ffd23f', '#f28a1c', '#3a2a26', '#c8501e', '#8a3324']
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="7" fill="#121823" />
      {cells.map((fill, i) => (
        <rect key={i} x={5 + (i % 3) * 7.5} y={5 + Math.floor(i / 3) * 7.5} width="6.5" height="6.5" rx="1.2" fill={fill} />
      ))}
    </svg>
  )
}
