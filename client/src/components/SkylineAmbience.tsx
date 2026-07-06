import type { CSSProperties } from 'react';
import type { Flavor } from './skylineTheme';

function Cloud({ top, scale, opacity, dur, delay, blur }: {
  top: string; scale: number; opacity: number; dur: number; delay: number; blur?: number;
}) {
  const px = (n: number) => n * scale + 'px';
  const puff = (d: number, l: number, t: number, key: string): [string, CSSProperties] => [key, {
    position: 'absolute', width: px(d), height: px(d), left: px(l), top: px(t),
    borderRadius: '50%', background: '#ffffff',
  }];
  const puffs = [
    puff(94, 53, 14, 'p1'), puff(64, 12, 46, 'p2'), puff(74, 104, 38, 'p3'),
    puff(58, 78, 2, 'p4'), puff(46, 150, 30, 'p5'),
  ];
  return (
    <div style={{
      position: 'absolute', top, left: '-16%', width: px(200), height: px(122),
      filter: `blur(${blur || 3}px)`, opacity,
      animation: `sk-cloud ${dur}s linear ${delay}s infinite`, willChange: 'transform', pointerEvents: 'none',
    }}>
      <div style={{ position: 'absolute', width: px(186), height: px(50), left: px(7), top: px(66), borderRadius: px(25), background: '#ffffff' }} />
      {puffs.map(([key, style]) => <div key={key} style={style} />)}
    </div>
  );
}

function Wisp({ top, scale, opacity, dur, delay }: { top: string; scale: number; opacity: number; dur: number; delay: number }) {
  return (
    <div style={{
      position: 'absolute', top, left: '-18%',
      width: 160 * scale + 'px', height: 15 * scale + 'px', borderRadius: '50%',
      background: 'radial-gradient(closest-side, rgba(150,92,116,0.6), rgba(110,68,100,0.28) 60%, transparent)',
      filter: 'blur(6px)', opacity,
      animation: `sk-wisp ${dur}s linear ${delay}s infinite`, willChange: 'transform', pointerEvents: 'none',
    }} />
  );
}

function rnd(i: number, seed: number): number {
  const v = Math.sin(i * seed) * 43758.5453;
  return v - Math.floor(v);
}

function NightAmbience() {
  const stars = [];
  for (let i = 1; i <= 78; i++) {
    const x = rnd(i, 12.9898) * 100;
    const y = rnd(i, 78.233) * 78;
    const s = 0.8 + rnd(i, 34.117) * 1.9;
    const d = rnd(i, 5.713) * 4.5;
    const dur = 2.6 + rnd(i, 9.137) * 3.6;
    stars.push(
      <div key={`st${i}`} style={{
        position: 'absolute', left: x.toFixed(2) + '%', top: y.toFixed(2) + '%',
        width: s.toFixed(2) + 'px', height: s.toFixed(2) + 'px', borderRadius: '50%',
        background: '#dce8fb', boxShadow: '0 0 3px rgba(200,222,255,0.7)',
        animation: `sk-twinkle ${dur.toFixed(2)}s ease-in-out ${d.toFixed(2)}s infinite`,
      }} />
    );
  }
  return (
    <div>
      {stars}
      <div style={{ position: 'absolute', left: '13%', top: '11%', width: '82px', height: '2px', borderRadius: '2px', background: 'linear-gradient(90deg, transparent, #eaf3ff)', boxShadow: '0 0 7px 1px rgba(200,225,255,0.85)', opacity: 0, animation: 'sk-shoot 78s linear 21s infinite' }} />
      <div style={{ position: 'absolute', left: '44%', top: '6%', width: '68px', height: '2px', borderRadius: '2px', background: 'linear-gradient(90deg, transparent, #eaf3ff)', boxShadow: '0 0 7px 1px rgba(200,225,255,0.85)', opacity: 0, animation: 'sk-shoot 117s linear 63s infinite' }} />
      <div style={{ position: 'absolute', right: '11%', top: '12%', width: '52px', height: '52px', borderRadius: '50%', background: 'radial-gradient(circle at 38% 38%, #f4f7ff, #c9d6ec)', boxShadow: '0 0 44px 8px rgba(210,225,250,0.35)' }} />
    </div>
  );
}

function DuskAmbience() {
  const stars = [];
  for (let i = 0; i < 16; i++) {
    const x = (i * 89 + 9) % 100, y = (i * 41 + 4) % 27, s = i % 3 ? 1.2 : 1.9, d = (i % 5) * 0.6;
    stars.push(
      <div key={`s${i}`} style={{
        position: 'absolute', left: x + '%', top: y + '%', width: s + 'px', height: s + 'px',
        borderRadius: '50%', background: '#fff1e8', opacity: 0.85,
        animation: `sk-twinkle ${3.5 + (i % 4)}s ease-in-out ${d}s infinite`,
      }} />
    );
  }
  return (
    <div>
      <div style={{ position: 'absolute', right: '19%', top: '40%', width: '164px', height: '164px', animation: 'sk-bob 9s ease-in-out infinite' }}>
        <div style={{ position: 'absolute', inset: '-62%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,178,116,0.52), rgba(255,146,92,0.18) 42%, transparent 66%)' }} />
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'radial-gradient(circle at 42% 40%, #ffe9b8, #ff9e5c 60%, #f5713f 88%)', boxShadow: '0 0 62px 16px rgba(255,150,90,0.42)' }} />
      </div>
      <Wisp top="43%" scale={1.4} opacity={0.5} dur={82} delay={-10} />
      <Wisp top="54%" scale={1.9} opacity={0.42} dur={112} delay={-58} />
      <Wisp top="35%" scale={1.0} opacity={0.4} dur={96} delay={-32} />
      <Wisp top="63%" scale={2.2} opacity={0.34} dur={134} delay={-85} />
      {stars}
    </div>
  );
}

function DayAmbience() {
  return (
    <div>
      <div style={{ position: 'absolute', right: '13%', top: '9%', width: '230px', height: '230px' }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,214,110,0.55), rgba(255,224,150,0.22) 42%, transparent 68%)' }} />
        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: '84px', height: '84px', borderRadius: '50%', background: 'radial-gradient(circle at 38% 36%, #fff6cf, #ffd24a 58%, #ffbf1e 82%)', boxShadow: '0 0 46px 10px rgba(255,205,90,0.5)' }} />
      </div>
      <Cloud top="12%" scale={1.3} opacity={0.92} dur={75} delay={-12} blur={5} />
      <Cloud top="25%" scale={0.85} opacity={0.8} dur={100} delay={-45} blur={4} />
      <Cloud top="6%" scale={1.7} opacity={0.85} dur={135} delay={-80} blur={8} />
      <Cloud top="33%" scale={0.6} opacity={0.62} dur={62} delay={-28} blur={3} />
      <Cloud top="19%" scale={1.05} opacity={0.82} dur={90} delay={-60} blur={5} />
    </div>
  );
}

export function SkylineAmbience({ flavor }: { flavor: Flavor }) {
  if (flavor === 'night') return <NightAmbience />;
  if (flavor === 'dusk') return <DuskAmbience />;
  return <DayAmbience />;
}
