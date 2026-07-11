// A full-screen confetti burst, fired when a session is saved. Ported from
// the design prototype's buildConfetti.
const COLORS = ['#f2a48c', '#a8c6a1', '#b8a3d9', '#f5d78e', '#9fc2d9', '#e8a3b8'];

export default function Confetti({ burstId }: { burstId: number }) {
  if (!burstId) return null;
  const bits = [];
  for (let i = 0; i < 44; i++) {
    const r = (s: number) => { const v = Math.sin((i + 1) * s + (burstId % 97)) * 43758.5453; return v - Math.floor(v); };
    bits.push(
      <div key={`cf${i}`} style={{
        position: 'absolute', left: (r(1.7) * 100).toFixed(1) + '%', top: '-20px',
        width: (5 + r(2.3) * 6).toFixed(0) + 'px', height: (8 + r(3.1) * 7).toFixed(0) + 'px',
        borderRadius: r(4.2) > 0.5 ? '50%' : '2px',
        background: COLORS[i % COLORS.length],
        animation: `wf-confetti ${(2 + r(5.9) * 1.4).toFixed(2)}s ease-in ${(r(7.7) * 0.5).toFixed(2)}s both`,
      }} />
    );
  }
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 90, pointerEvents: 'none', overflow: 'hidden' }}>{bits}</div>
  );
}
