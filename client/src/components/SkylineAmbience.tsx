import type { CSSProperties } from 'react';
import type { Weather } from '../types';
import type { Flavor } from './skylineTheme';

function Cloud({ top, scale, opacity, dur, delay, blur, tone }: {
  top: string; scale: number; opacity: number; dur: number; delay: number; blur?: number; tone?: string;
}) {
  const fill = tone || '#fffdf7';
  const px = (n: number) => n * scale + 'px';
  const puff = (d: number, l: number, t: number, key: string): [string, CSSProperties] => [key, {
    position: 'absolute', width: px(d), height: px(d), left: px(l), top: px(t),
    borderRadius: '50%', background: fill,
  }];
  const puffs = [
    puff(84, 48, 10, 'p1'), puff(58, 14, 36, 'p2'), puff(64, 108, 28, 'p3'),
  ];
  return (
    <div style={{
      position: 'absolute', top, left: '-16%', width: px(190), height: px(110),
      filter: `blur(${blur || 2}px)`, opacity,
      animation: `wf-cloud ${dur}s linear ${delay}s infinite`, willChange: 'transform', pointerEvents: 'none',
    }}>
      <div style={{ position: 'absolute', width: px(176), height: px(52), left: px(7), top: px(58), borderRadius: px(26), background: fill }} />
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
  for (let i = 1; i <= 60; i++) {
    const x = rnd(i, 12.9898) * 100;
    const y = rnd(i, 78.233) * 70;
    const s = 1 + rnd(i, 34.117) * 2.2;
    const d = rnd(i, 5.713) * 4.5;
    const dur = 2.6 + rnd(i, 9.137) * 3.6;
    stars.push(
      <div key={`st${i}`} style={{
        position: 'absolute', left: x.toFixed(2) + '%', top: y.toFixed(2) + '%',
        width: s.toFixed(2) + 'px', height: s.toFixed(2) + 'px', borderRadius: '50%',
        background: '#f3e9ff', boxShadow: '0 0 4px rgba(240,225,255,0.8)',
        animation: `wf-twinkle ${dur.toFixed(2)}s ease-in-out ${d.toFixed(2)}s infinite`,
      }} />
    );
  }
  const fireflies = [];
  for (let i = 1; i <= 9; i++) {
    fireflies.push(
      <div key={`ff${i}`} style={{
        position: 'absolute', left: (8 + rnd(i, 3.77) * 84).toFixed(1) + '%', bottom: (12 + rnd(i, 8.21) * 30).toFixed(1) + '%',
        width: '5px', height: '5px', borderRadius: '50%', background: '#ffe9a3', boxShadow: '0 0 8px 2px rgba(255,225,140,0.8)',
        animation: `wf-firefly ${(4 + rnd(i, 6.3) * 5).toFixed(1)}s ease-in-out ${(rnd(i, 2.9) * 4).toFixed(1)}s infinite`,
      }} />
    );
  }
  return (
    <div>
      {stars}
      {fireflies}
      {/* Shooting stars — kept from the current app. */}
      <div style={{ position: 'absolute', left: '13%', top: '11%', width: '82px', height: '2px', borderRadius: '2px', background: 'linear-gradient(90deg, transparent, #f3e9ff)', boxShadow: '0 0 7px 1px rgba(230,215,255,0.85)', opacity: 0, animation: 'sk-shoot 78s linear 21s infinite' }} />
      <div style={{ position: 'absolute', left: '44%', top: '6%', width: '68px', height: '2px', borderRadius: '2px', background: 'linear-gradient(90deg, transparent, #f3e9ff)', boxShadow: '0 0 7px 1px rgba(230,215,255,0.85)', opacity: 0, animation: 'sk-shoot 117s linear 63s infinite' }} />
      <div style={{ position: 'absolute', right: '12%', top: '10%', width: '64px', height: '64px', animation: 'wf-bob 11s ease-in-out infinite' }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'radial-gradient(circle at 40% 38%, #fff8e0, #ffe9ad)', boxShadow: '0 0 40px 10px rgba(255,230,160,0.35)' }} />
        <div style={{ position: 'absolute', left: '-16%', top: '-14%', width: '78%', height: '78%', borderRadius: '50%', background: '#241f45' }} />
      </div>
    </div>
  );
}

function DuskAmbience() {
  const stars = [];
  for (let i = 0; i < 12; i++) {
    const x = (i * 89 + 9) % 100, y = (i * 41 + 4) % 24;
    stars.push(
      <div key={`s${i}`} style={{
        position: 'absolute', left: x + '%', top: y + '%', width: '2px', height: '2px',
        borderRadius: '50%', background: '#fff1e8', opacity: 0.85,
        animation: `wf-twinkle ${3.5 + (i % 4)}s ease-in-out ${(i % 5) * 0.6}s infinite`,
      }} />
    );
  }
  return (
    <div>
      <div style={{ position: 'absolute', right: '18%', top: '38%', width: '130px', height: '130px', animation: 'wf-bob 10s ease-in-out infinite' }}>
        <div style={{ position: 'absolute', inset: '-55%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,178,116,0.5), rgba(255,146,92,0.16) 44%, transparent 66%)' }} />
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'radial-gradient(circle at 42% 40%, #ffe9b8, #ff9e5c 62%, #f5713f 90%)', boxShadow: '0 0 56px 14px rgba(255,150,90,0.4)' }} />
      </div>
      <Wisp top="43%" scale={1.4} opacity={0.5} dur={82} delay={-10} />
      <Wisp top="54%" scale={1.9} opacity={0.42} dur={112} delay={-58} />
      <Cloud top="18%" scale={1.1} opacity={0.5} dur={95} delay={-30} blur={3} />
      <Cloud top="30%" scale={0.7} opacity={0.4} dur={120} delay={-70} blur={3} />
      {stars}
    </div>
  );
}

function DayAmbience() {
  return (
    <div>
      <div style={{ position: 'absolute', right: '12%', top: '8%', width: '190px', height: '190px' }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,204,110,0.55), rgba(255,214,150,0.2) 44%, transparent 68%)' }} />
        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: '76px', height: '76px', borderRadius: '50%', background: 'radial-gradient(circle at 38% 36%, #fff2c4, #ffc94a 60%, #f5a52e 86%)', boxShadow: '0 0 42px 10px rgba(255,190,80,0.5)', animation: 'wf-bob 9s ease-in-out infinite' }} />
      </div>
      <Cloud top="10%" scale={1.3} opacity={0.92} dur={80} delay={-12} blur={2} />
      <Cloud top="24%" scale={0.85} opacity={0.8} dur={105} delay={-45} blur={2} />
      <Cloud top="5%" scale={1.6} opacity={0.85} dur={140} delay={-80} blur={3} />
      <Cloud top="32%" scale={0.6} opacity={0.65} dur={66} delay={-28} blur={2} />
    </div>
  );
}

export function SkylineAmbience({ flavor }: { flavor: Flavor }) {
  if (flavor === 'night') return <NightAmbience />;
  if (flavor === 'dusk') return <DuskAmbience />;
  return <DayAmbience />;
}

// ---- Energy weather ---------------------------------------------------------
// The energy forecast rendered as village weather, layered over the time-of-day
// ambience. Deliberately gentle: `clouding` is a soft overcast (a dim wash and
// a couple of drifting gray clouds), `storm` adds a cozy drizzle — the village
// hunkers down, nothing flashes red or reads as an alarm.

function Drizzle() {
  const drops = [];
  for (let i = 1; i <= 26; i++) {
    const left = 2 + rnd(i, 17.31) * 96;
    const dur = 1.7 + rnd(i, 6.71) * 1.1;
    const delay = -rnd(i, 3.19) * 4;
    const len = 11 + rnd(i, 9.43) * 7;
    drops.push(
      <div key={`rd${i}`} style={{
        position: 'absolute', left: left.toFixed(1) + '%', top: '-24px',
        width: '2px', height: len.toFixed(0) + 'px', borderRadius: '2px',
        background: 'linear-gradient(180deg, rgba(150,163,205,0.05), rgba(150,163,205,0.55))',
        animation: `wf-rain ${dur.toFixed(2)}s linear ${delay.toFixed(2)}s infinite`, willChange: 'transform',
      }} />
    );
  }
  return <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>{drops}</div>;
}

export function EnergyWeatherOverlay({ weather, flavor }: { weather: Weather; flavor: Flavor }) {
  if (weather === 'clear') return null;
  // Softer, grayer clouds than the sunny-day ones; a touch dimmer at night so
  // they read as overcast rather than glowing.
  const tone = flavor === 'night' ? '#8f8aa6' : flavor === 'dusk' ? '#b7a8b8' : '#ded8d2';
  const cloudOpacity = flavor === 'day' ? 0.75 : 0.55;
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(180deg, rgba(94,88,116,0.20), rgba(94,88,116,0.08) 55%, transparent 80%)',
      }} />
      <Cloud top="4%" scale={1.5} opacity={cloudOpacity} dur={110} delay={-35} blur={3} tone={tone} />
      <Cloud top="16%" scale={1.0} opacity={cloudOpacity * 0.85} dur={88} delay={-62} blur={3} tone={tone} />
      {weather === 'storm' && <Cloud top="9%" scale={0.75} opacity={cloudOpacity * 0.8} dur={72} delay={-18} blur={2} tone={tone} />}
      {weather === 'storm' && <Drizzle />}
    </div>
  );
}
