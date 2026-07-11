import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Project, Trend } from '../types';
import { colorsFor, type HouseShades } from './houseColors';
import { flavorForTime, themeFor, type Flavor } from './skylineTheme';
import { SkylineAmbience } from './SkylineAmbience';
import { trendWord } from './village';

interface SkylineProps {
  projects: Project[];
  onRequestReorder?: () => void;
  truthOverride?: string | null;
}

interface Building {
  id: string; name: string; rank: number; lastMoved: string;
  sessions: string; threshold: string; note: string; totalHours: number;
  h: number; w: number; recentSessions: number; trend: Trend;
  quiet: boolean; showCheckin: boolean; checkinText: string;
  colors: HouseShades; trendWord: 'buzzing' | 'steady' | 'napping';
}

// One lit window per session worked in the past month; dark if none.
function Grid({ sessions, h, winOnGlow }: { sessions: number; h: number; winOnGlow: boolean }) {
  const rows = Math.max(3, Math.round((h - 60) / 36));
  const total = rows * 3;
  const lit = Math.min(total, Math.max(0, sessions));
  const cells = [];
  for (let i = 0; i < total; i++) {
    const on = i >= total - lit;
    cells.push(
      <div key={i} style={{
        aspectRatio: '3 / 4', borderRadius: '4px',
        background: on ? 'var(--win-on)' : 'var(--win-off)',
        boxShadow: on && winOnGlow ? '0 0 8px 2px var(--glow)' : 'inset 0 -2px 0 rgba(70,45,20,.08)',
        transition: 'background .5s ease',
      }} />
    );
  }
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '6px',
      padding: '16px 13px 44px', height: '100%', boxSizing: 'border-box', alignContent: 'end',
    }}>{cells}</div>
  );
}

// Momentum weather: a little rain cloud drips over houses that have gone
// quiet, sparkles twinkle over houses that are picking up steam.
function HouseWeather({ quiet, rising }: { quiet: boolean; rising: boolean }) {
  if (quiet) {
    const drops = [0, 1, 2].map(i => (
      <div key={`d${i}`} style={{
        position: 'absolute', left: (16 + i * 16) + 'px', top: '30px', width: '3px', height: '9px', borderRadius: '3px',
        background: '#9caed4', animation: `wf-drop 1.3s linear ${i * 0.42}s infinite`,
      }} />
    ));
    return (
      <div style={{ position: 'absolute', top: '-58px', left: '50%', transform: 'translateX(-50%)', width: '64px', height: '60px', zIndex: 7, animation: 'wf-sway 6s ease-in-out infinite', pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', left: '4px', top: '12px', width: '56px', height: '20px', borderRadius: '12px', background: '#c3cde6' }} />
        <div style={{ position: 'absolute', left: '10px', top: '0px', width: '26px', height: '26px', borderRadius: '50%', background: '#c3cde6' }} />
        <div style={{ position: 'absolute', left: '30px', top: '4px', width: '22px', height: '22px', borderRadius: '50%', background: '#d0d9ee' }} />
        {drops}
      </div>
    );
  }
  if (rising) {
    const sparks = [0, 1, 2].map(i => (
      <div key={`s${i}`} style={{
        position: 'absolute', left: (6 + i * 22) + 'px', top: (i % 2 ? 18 : 2) + 'px', width: '10px', height: '10px',
        background: 'var(--win-on)', clipPath: 'polygon(50% 0,63% 37%,100% 50%,63% 63%,50% 100%,37% 63%,0 50%,37% 37%)',
        animation: `wf-twinkle ${1.8 + i * 0.5}s ease-in-out ${i * 0.4}s infinite`, filter: 'drop-shadow(0 0 4px var(--glow))',
      } as CSSProperties} />
    ));
    return <div style={{ position: 'absolute', top: '-40px', left: '50%', transform: 'translateX(-50%)', width: '60px', height: '30px', zIndex: 7, pointerEvents: 'none' }}>{sparks}</div>;
  }
  return null;
}

const cssVars = (vars: Record<string, string>) => vars as CSSProperties;

export default function Skyline({ projects, onRequestReorder, truthOverride }: SkylineProps) {
  const [weatherOn, setWeatherOn] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkin, setCheckin] = useState<string | null>(null);
  const [now, setNow] = useState(new Date());
  const [override, setOverride] = useState<Flavor | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);

  const flavor = override || flavorForTime(now);
  const isAuto = !override;
  const tv = themeFor(flavor);

  const rootStyle: CSSProperties = {
    ...cssVars(tv.vars),
    position: 'relative', width: '100%', height: '100%', minHeight: '780px', overflow: 'hidden',
    borderRadius: '26px', background: 'var(--sky)', color: 'var(--ink)',
    fontFamily: "'Nunito', system-ui, sans-serif",
    display: 'flex', flexDirection: 'column',
    boxShadow: '0 24px 60px rgba(80,50,20,.18), 0 6px 0 rgba(150,110,70,.12)',
  };

  const buildings: Building[] = useMemo(() => projects.map((p, i) => {
    // Height reflects time invested (stature = log of total hours), and the
    // building grows further if a month's sessions need more windows than fit.
    const hFromTime = Math.round(134 + p.stature * 178);
    const hForSessions = 60 + Math.ceil(Math.max(1, p.recentSessions) / 3) * 36 + 16;
    const h = Math.min(352, Math.max(hFromTime, hForSessions));
    const w = Math.round(84 + p.stature * 24);
    return {
      id: p.id, name: p.name, rank: i + 1, lastMoved: p.lastMoved,
      sessions: p.sessions, threshold: p.threshold, note: p.note, totalHours: p.totalHours,
      h, w, recentSessions: p.recentSessions, trend: p.trend,
      quiet: p.quiet, showCheckin: p.quiet,
      checkinText: i === 0 ? 'This hasn’t moved in a while — still your #1?' : 'This has been quiet — still a priority?',
      colors: colorsFor(p.houseColor, p.id),
      trendWord: trendWord(p),
    };
  }), [projects]);

  const sel = buildings.find(b => b.id === selectedId) || null;

  const mostActive = buildings.reduce<Building | null>((b, p) => (!b || p.recentSessions > b.recentSessions) ? p : b, null);
  const quietOne = buildings.find(b => b.quiet) || null;
  const storyLine = truthOverride
    ? truthOverride
    : quietOne
      ? `The ${quietOne.name} house has been napping since ${quietOne.lastMoved} — its windows have gone dark. Meanwhile the ${mostActive ? mostActive.name : ''} house is glowing; someone was in there ${mostActive ? mostActive.lastMoved : ''}.`
      : `Every house on the street has its lights on. The ${mostActive ? mostActive.name : ''} house is the busiest — someone was in there ${mostActive ? mostActive.lastMoved : ''}.`;

  const detailLine = sel
    ? sel.quiet
      ? `The ${sel.name} house has been napping since ${sel.lastMoved} — its windows have gone dark.`
      : sel.trend === 'rising'
        ? `The ${sel.name} house is buzzing — someone was in there ${sel.lastMoved}.`
        : `The ${sel.name} house is pottering along nicely.`
    : '';

  const trackStyle: CSSProperties = {
    width: '48px', height: '27px', borderRadius: '20px', flex: '0 0 auto',
    background: weatherOn ? 'var(--accent)' : 'var(--track-off)', position: 'relative', transition: 'background .3s ease',
  };
  const knobStyle: CSSProperties = {
    position: 'absolute', top: '3px', left: '3px', width: '21px', height: '21px', borderRadius: '50%',
    background: '#fff', boxShadow: '0 2px 5px rgba(0,0,0,.25)',
    transform: weatherOn ? 'translateX(21px)' : 'translateX(0)', transition: 'transform .3s ease',
  };

  const names: Record<Flavor, string> = { day: 'day', dusk: 'dusk', night: 'night' };
  const timeStr = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const variantName = isAuto
    ? `population: your projects · ${names[flavor]} mode, ${timeStr}`
    : `population: your projects · pretending it’s ${names[flavor]}`;

  const modes: { key: 'auto' | Flavor; label: string }[] = [
    { key: 'auto', label: 'Auto' }, { key: 'day', label: 'Day' }, { key: 'dusk', label: 'Dusk' }, { key: 'night', label: 'Night' },
  ];

  return (
    <div style={rootStyle}>
      <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden', borderRadius: '26px' }}>
        <SkylineAmbience flavor={flavor} />
      </div>

      <div style={{ position: 'relative', zIndex: 6, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '26px 30px 0', gap: '18px' }}>
        <div>
          <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 800, fontSize: '29px', lineHeight: 1.1, color: 'var(--ink)' }}>Katie's Skyline</div>
          <div style={{ fontSize: '12.5px', color: 'var(--ink-soft)', marginTop: '5px', fontWeight: 600 }}>{variantName}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginTop: '12px' }}>
            <div style={{ display: 'flex', gap: '3px', padding: '4px', borderRadius: '15px', background: 'var(--card)', border: '2px solid var(--stroke)' }}>
              {modes.map(m => {
                const active = m.key === 'auto' ? isAuto : override === m.key;
                return (
                  <div key={m.key} onClick={() => setOverride(m.key === 'auto' ? null : m.key)} style={{
                    cursor: 'pointer', fontSize: '11.5px', fontWeight: 800, padding: '5px 13px', borderRadius: '11px',
                    background: active ? 'var(--accent)' : 'transparent',
                    color: active ? '#ffffff' : 'var(--ink-soft)', transition: 'background .2s, color .2s', whiteSpace: 'nowrap',
                  }}>{m.label}</div>
                );
              })}
            </div>
          </div>
        </div>
        <div onClick={() => setWeatherOn(v => !v)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '11px', padding: '10px 14px', borderRadius: '18px', border: '2px solid var(--stroke)', background: 'var(--card)' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '12.5px', fontWeight: 800, color: 'var(--ink)' }}>Momentum weather</div>
            <div style={{ fontSize: '10.5px', color: 'var(--ink-soft)', fontWeight: 600 }}>rain over sleepy houses, sparkles on busy ones</div>
          </div>
          <div style={trackStyle}><div style={knobStyle} /></div>
        </div>
      </div>

      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: '108px', zIndex: 4, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: '24px', padding: '0 34px 0' }}>
          {buildings.map(b => (
            <div key={b.id} style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', width: Math.max(b.w, 116) + 'px' }}>
              {weatherOn && <HouseWeather quiet={b.quiet} rising={b.trend === 'rising' && !b.quiet} />}
              <div onClick={() => { setSelectedId(b.id); setCheckin(null); }} style={{
                position: 'relative', zIndex: 5, width: b.w + 'px', height: b.h + 'px', cursor: 'pointer',
                borderRadius: '10px 10px 0 0', background: b.colors.body,
                boxShadow: 'inset 0 0 0 2px rgba(70,50,30,.10), 0 -4px 30px rgba(60,40,20,.10)',
                overflow: 'hidden', transition: 'transform .25s ease, height .5s ease',
              }}>
                <div style={{ position: 'absolute', inset: 0, background: tv.tint, pointerEvents: 'none' }} />
                <Grid sessions={b.recentSessions} h={b.h} winOnGlow={tv.winOnGlow} />
                <div style={{ position: 'absolute', left: '50%', bottom: 0, transform: 'translateX(-50%)', width: '22px', height: '30px', borderRadius: '11px 11px 0 0', background: b.colors.door }} />
                {b.id === selectedId && <div style={{ position: 'absolute', inset: 0, borderRadius: '10px 10px 0 0', boxShadow: 'inset 0 0 0 3px var(--accent)', pointerEvents: 'none' }} />}
              </div>
            </div>
          ))}
        </div>

        {/* labels: a separate row so rank/name/last-visited sit flush regardless of house height */}
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 4, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: '24px', padding: '0 34px 20px' }}>
          {buildings.map(b => (
            <div key={b.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px', width: Math.max(b.w, 116) + 'px', padding: '0 4px', boxSizing: 'border-box', textAlign: 'center' }}>
              <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'var(--card)', border: '2px solid var(--stroke)', color: 'var(--ink)', fontSize: '11px', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>{b.rank}</div>
              <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 800, fontSize: '13.5px', color: 'var(--ink)', lineHeight: 1.25, textWrap: 'balance' as CSSProperties['textWrap'] }}>{b.name}</div>
              <div style={{ fontSize: '11px', color: 'var(--ink-soft)', fontWeight: 600 }}>{b.lastMoved}</div>
            </div>
          ))}
        </div>

        {sel && (
          <div style={{ position: 'absolute', top: '86px', right: '24px', zIndex: 9, width: '272px', background: 'var(--card)', border: '2px solid var(--card-bd)', borderRadius: '20px', padding: '17px 18px', backdropFilter: 'blur(12px)', boxShadow: '0 16px 40px rgba(50,30,10,.25)', animation: 'wf-rise .3s ease both' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
              <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 800, fontSize: '17px', color: 'var(--ink)' }}>{sel.name}</div>
              <div onClick={() => { setSelectedId(null); setCheckin(null); }} title="Back to the city" style={{ cursor: 'pointer', color: 'var(--ink-soft)', fontSize: '16px', lineHeight: 1, padding: '2px 4px' }}>×</div>
            </div>
            <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontWeight: 400, fontStyle: 'italic', fontSize: '13.5px', lineHeight: 1.4, color: 'var(--ink)', opacity: 0.9, marginTop: '4px' }}>{detailLine}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', marginTop: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}><span style={{ color: 'var(--ink-soft)', fontWeight: 600 }}>Spot in line</span><span style={{ color: 'var(--ink)', fontWeight: 800 }}>#{sel.rank}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}><span style={{ color: 'var(--ink-soft)', fontWeight: 600 }}>Last visit</span><span style={{ color: 'var(--ink)', fontWeight: 800 }}>{sel.lastMoved}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}><span style={{ color: 'var(--ink-soft)', fontWeight: 600 }}>Visits this month</span><span style={{ color: 'var(--ink)', fontWeight: 800 }}>{sel.sessions}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}><span style={{ color: 'var(--ink-soft)', fontWeight: 600 }}>Hours, all time</span><span style={{ color: 'var(--ink)', fontWeight: 800 }}>{sel.totalHours}h</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}><span style={{ color: 'var(--ink-soft)', fontWeight: 600 }}>Check-in threshold</span><span style={{ color: 'var(--ink)', fontWeight: 800 }}>{sel.threshold}</span></div>
            </div>
            {sel.note && <div style={{ fontSize: '13px', lineHeight: 1.5, color: 'var(--ink)', opacity: .88, marginTop: '12px', paddingTop: '11px', borderTop: '2px dashed var(--stroke)' }}>{sel.note}</div>}

            {sel.showCheckin && (
              <div style={{ marginTop: '12px', padding: '12px 13px', borderRadius: '14px', background: 'var(--fog)', border: '2px solid var(--stroke)' }}>
                <div style={{ fontSize: '12.5px', color: 'var(--ink)', lineHeight: 1.4, fontWeight: 600 }}>{sel.checkinText}</div>
                {!checkin ? (
                  <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                    <div onClick={() => setCheckin('Kept at #' + sel.rank + '.')} style={{ cursor: 'pointer', flex: 1, textAlign: 'center', fontSize: '12px', fontWeight: 800, padding: '8px', borderRadius: '11px', background: 'var(--accent)', color: '#fff' }}>Yes, keep it</div>
                    <div onClick={() => { setCheckin('Opening priority view to reorder…'); onRequestReorder?.(); }} style={{ cursor: 'pointer', flex: 1, textAlign: 'center', fontSize: '12px', fontWeight: 800, padding: '8px', borderRadius: '11px', background: 'transparent', border: '2px solid var(--stroke)', color: 'var(--ink)' }}>Reorder</div>
                  </div>
                ) : (
                  <div style={{ fontSize: '12px', color: 'var(--ink)', marginTop: '10px', display: 'flex', alignItems: 'center', gap: '7px', fontWeight: 600 }}><span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent)' }} />{checkin}</div>
                )}
              </div>
            )}
            <div onClick={() => { setSelectedId(null); setCheckin(null); }} style={{ cursor: 'pointer', textAlign: 'center', fontSize: '11.5px', fontWeight: 800, color: 'var(--accent)', marginTop: '13px' }}>← Back to the city</div>
          </div>
        )}
      </div>

      <div style={{ position: 'relative', zIndex: 6, padding: '18px 30px 24px', borderTop: '2px solid var(--stroke)', background: 'var(--card)', backdropFilter: 'blur(8px)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ maxWidth: '640px', fontFamily: "'Fraunces', Georgia, serif", fontWeight: 600, fontSize: '19px', lineHeight: 1.4, color: 'var(--ink)', textWrap: 'pretty' as CSSProperties['textWrap'] }}>
            {storyLine}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '10.5px', color: 'var(--ink-soft)', whiteSpace: 'nowrap', fontWeight: 700 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}><span style={{ width: '10px', height: '11px', borderRadius: '3px', background: 'var(--win-on)', boxShadow: '0 0 6px var(--glow)' }} />lit window = one visit this month</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}><span style={{ color: 'var(--ink)' }}>▲</span>taller house = more love over time</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}><span style={{ color: 'var(--ink)' }}>←</span>closer to the front = higher priority</div>
          </div>
        </div>
      </div>
    </div>
  );
}
