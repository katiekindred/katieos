import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { CalendarEvent, Project, Trend } from '../types';
import { flavorForTime, themeFor, type Flavor } from './skylineTheme';
import { SkylineAmbience } from './SkylineAmbience';

interface SkylineProps {
  projects: Project[];
  calendarEvents?: CalendarEvent[];
  onRequestReorder?: () => void;
}

interface Building {
  id: string; name: string; rank: number; lastMoved: string;
  sessions: string; threshold: string; note: string;
  h: number; w: number; activity: number; trend: Trend;
  halo: boolean; quiet: boolean; showCheckin: boolean; checkinText: string;
  showPin: boolean; pinLabel: string; showTrend: boolean;
  recoveryNote: string | null;
}

function Grid({ activity, h, flavor }: { activity: number; h: number; flavor: Flavor }) {
  const rows = Math.max(3, Math.round((h - 44) / 36));
  const total = rows * 3;
  const lit = activity <= 0 ? 0 : Math.max(1, Math.round(total * activity));
  const cells = [];
  for (let i = 0; i < total; i++) {
    const on = i >= total - lit;
    cells.push(
      <div key={i} style={{
        aspectRatio: '3 / 4', borderRadius: '1px',
        background: on ? 'var(--win-on)' : 'var(--win-off)',
        boxShadow: on && flavor !== 'day' ? '0 0 7px 1px var(--glow)' : 'none',
        transition: 'background .5s ease',
      }} />
    );
  }
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '5px',
      padding: '24px 12px 16px', height: '100%', boxSizing: 'border-box', alignContent: 'end',
    }}>{cells}</div>
  );
}

function Plume({ trend }: { trend: Trend }) {
  if (trend === 'fading') return <div style={{ position: 'absolute', left: '-18%', right: '-18%', bottom: 0, height: '145%', background: 'linear-gradient(180deg, transparent 0%, var(--fog) 60%, var(--fog) 100%)', filter: 'blur(7px)', borderRadius: '50% 50% 0 0', pointerEvents: 'none' }} />;
  if (trend === 'rising') return <div style={{ position: 'absolute', left: '-6%', right: '-6%', bottom: '30%', height: '95%', background: 'radial-gradient(60% 70% at 50% 100%, var(--glow), transparent 70%)', opacity: 0.55, filter: 'blur(5px)', pointerEvents: 'none' }} />;
  return <div style={{ position: 'absolute', left: '-10%', right: '-10%', bottom: 0, height: '110%', background: 'linear-gradient(180deg, transparent, var(--fog))', opacity: 0.55, filter: 'blur(6px)', pointerEvents: 'none' }} />;
}

interface TruthRanked { id: string; name: string; rank: number; quiet: boolean; activity: number; lastMoved: string }

function buildTruth(ranked: TruthRanked[]) {
  const phrase = (lm: string) => /ago|just|today|yesterday|week|month|day/i.test(lm) ? `it’s been quiet — last touched ${lm}` : `it hasn’t moved since ${lm}`;
  const A = ranked.find(p => p.quiet);
  if (A) {
    const B = ranked.reduce<TruthRanked | null>((b, p) => (p.id !== A.id && (!b || p.activity > b.activity)) ? p : b, null) || A;
    return { pre: 'You’ve kept ', aName: A.name, mid: ` at #${A.rank} since you set this up — ${phrase(A.lastMoved)}. Meanwhile `, bName: B.name, post: `, ranked #${B.rank}, moved ${B.lastMoved}.` };
  }
  const top = ranked[0] || { name: '—', rank: 1, lastMoved: '—', id: '_', quiet: false, activity: 0 };
  let B = ranked.reduce<TruthRanked | null>((b, p) => (!b || p.activity > b.activity) ? p : b, null) || top;
  if (B.id === top.id) B = ranked.filter(p => p.id !== top.id).reduce<TruthRanked | null>((b, p) => (!b || p.activity > b.activity) ? p : b, null) || top;
  return { pre: 'Nothing’s drifting — you’ve kept ', aName: top.name, mid: ` at #1, and it moved ${top.lastMoved}. `, bName: B.name, post: `, ranked #${B.rank}, is your most recent — ${B.lastMoved}.` };
}

function buildDrift(ranked: (TruthRanked & { recoveryNote: string | null })[]) {
  const A = ranked.find(p => p.quiet);
  if (!A) return null;
  const body = A.recoveryNote
    ? `Last time it went quiet this long, ${A.recoveryNote} — and it held.`
    : 'Nothing in your logged activity yet shows what got it moving again last time.';
  return { title: `${A.name} is drifting to the edge`, body };
}

function matchPin(name: string, events: CalendarEvent[]): { label: string } | null {
  const key = name.split(/[\s/]+/)[0].toLowerCase();
  const match = events.find(e => e.project.toLowerCase().includes(key) || key.includes(e.project.toLowerCase()));
  if (!match) return null;
  return { label: `${match.title} · ${match.date}` };
}

const cssVars = (vars: Record<string, string>) => vars as CSSProperties;

export default function Skyline({ projects, calendarEvents = [], onRequestReorder }: SkylineProps) {
  const [forecastOn, setForecastOn] = useState(false);
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
    ...cssVars(tv),
    position: 'relative', width: '100%', height: '100%', minHeight: '780px', overflow: 'hidden',
    borderRadius: '18px', background: 'var(--sky)', color: 'var(--ink)',
    fontFamily: "'Hanken Grotesk', system-ui, sans-serif",
    display: 'flex', flexDirection: 'column',
    boxShadow: '0 30px 80px rgba(10,20,40,0.28)',
  };

  const buildings: Building[] = useMemo(() => projects.map((p, i) => {
    const h = Math.round(134 + p.stature * 178);
    const w = Math.round(78 + p.stature * 22);
    const pin = forecastOn ? matchPin(p.name, calendarEvents) : null;
    return {
      id: p.id, name: p.name, rank: i + 1, lastMoved: p.lastMoved,
      sessions: p.sessions, threshold: p.threshold, note: p.note,
      h, w, activity: p.activity, trend: p.trend,
      halo: forecastOn && p.activity > 0.85,
      quiet: p.quiet, showCheckin: p.quiet,
      checkinText: i === 0 ? 'This hasn’t moved in a while — still your #1?' : 'This has been quiet — still a priority?',
      showPin: !!pin, pinLabel: pin?.label || '',
      showTrend: forecastOn && p.trend !== 'steady',
      recoveryNote: p.recoveryNote,
    };
  }), [projects, forecastOn, calendarEvents]);

  const sel = buildings.find(b => b.id === selectedId) || null;
  const ranked: TruthRanked[] = buildings.map(b => ({ id: b.id, name: b.name, rank: b.rank, quiet: b.quiet, activity: b.activity, lastMoved: b.lastMoved }));
  const truth = buildTruth(ranked);
  const drift = buildDrift(buildings.map(b => ({ id: b.id, name: b.name, rank: b.rank, quiet: b.quiet, activity: b.activity, lastMoved: b.lastMoved, recoveryNote: b.recoveryNote })));

  const trackStyle: CSSProperties = {
    width: '46px', height: '26px', borderRadius: '20px', flex: '0 0 auto',
    background: forecastOn ? 'var(--accent)' : 'var(--track-off)', position: 'relative', transition: 'background .3s ease',
  };
  const knobStyle: CSSProperties = {
    position: 'absolute', top: '3px', left: '3px', width: '20px', height: '20px', borderRadius: '50%',
    background: '#fff', boxShadow: '0 2px 5px rgba(0,0,0,.3)',
    transform: forecastOn ? 'translateX(20px)' : 'translateX(0)', transition: 'transform .3s ease',
  };

  const names: Record<Flavor, string> = { day: 'Day', dusk: 'Dusk', night: 'Night' };
  const timeStr = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const variantName = isAuto
    ? `Live · ${names[flavor]} — ${timeStr}, updates at sunset`
    : `Preview · ${names[flavor]} — manual override`;

  const modes: { key: 'auto' | Flavor; label: string }[] = [
    { key: 'auto', label: 'Auto' }, { key: 'day', label: 'Day' }, { key: 'dusk', label: 'Dusk' }, { key: 'night', label: 'Night' },
  ];

  return (
    <div style={rootStyle}>
      <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden', borderRadius: '18px' }}>
        <SkylineAmbience flavor={flavor} />
      </div>

      <div style={{ position: 'relative', zIndex: 6, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '26px 30px 0', gap: '18px' }}>
        <div>
          <div style={{ fontFamily: "'Newsreader',Georgia,serif", fontSize: '27px', lineHeight: 1.1, color: 'var(--ink)' }}>The retrospective skyline</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '7px' }}>
            {isAuto
              ? <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#46d17f', animation: 'sk-pulse 2s ease-out infinite', flex: '0 0 auto' }} />
              : <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--win-on)', flex: '0 0 auto' }} />}
            <div style={{ fontSize: '12.5px', color: 'var(--ink-soft)' }}>{variantName}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px', marginTop: '11px' }}>
            <span style={{ fontSize: '9.5px', letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--ink-soft)', fontWeight: 700 }}>Preview</span>
            <div style={{ display: 'flex', gap: '3px', padding: '3px', borderRadius: '11px', background: 'var(--card)', border: '1px solid var(--stroke)', backdropFilter: 'blur(6px)' }}>
              {modes.map(m => {
                const active = m.key === 'auto' ? isAuto : override === m.key;
                return (
                  <div key={m.key} onClick={() => setOverride(m.key === 'auto' ? null : m.key)} style={{
                    cursor: 'pointer', fontSize: '11.5px', fontWeight: 600, padding: '5px 12px', borderRadius: '8px',
                    background: active ? 'var(--accent)' : 'transparent',
                    color: active ? '#ffffff' : 'var(--ink-soft)', transition: 'background .2s, color .2s', whiteSpace: 'nowrap',
                  }}>{m.label}</div>
                );
              })}
            </div>
          </div>
        </div>
        <div onClick={() => setForecastOn(v => !v)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '11px', padding: '9px 13px', borderRadius: '14px', border: '1px solid var(--stroke)', background: 'var(--card)', backdropFilter: 'blur(6px)' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--ink)' }}>Ghost forecast</div>
            <div style={{ fontSize: '10.5px', color: 'var(--ink-soft)' }}>where this is heading</div>
          </div>
          <div style={trackStyle}><div style={knobStyle} /></div>
        </div>
      </div>

      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {forecastOn && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 3, pointerEvents: 'none', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', left: '-15%', right: '-15%', bottom: '18%', height: '60%', background: 'radial-gradient(60% 100% at 30% 100%, var(--fog), transparent 70%)', filter: 'blur(10px)', animation: 'sk-fog 13s ease-in-out infinite' }} />
            <div style={{ position: 'absolute', left: '-15%', right: '-15%', bottom: '8%', height: '52%', background: 'radial-gradient(55% 100% at 70% 100%, var(--fog), transparent 72%)', filter: 'blur(14px)', animation: 'sk-fog2 17s ease-in-out infinite' }} />
          </div>
        )}

        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 4, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: '26px', padding: '0 34px 26px' }}>
          {buildings.map(b => (
            <div key={b.id} style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', width: b.w + 'px' }}>
              {b.showPin && (
                <div style={{ position: 'absolute', top: '-46px', zIndex: 7, display: 'flex', flexDirection: 'column', alignItems: 'center', animation: 'sk-rise .5s ease both' }}>
                  <div style={{ background: 'var(--pin)', color: 'var(--pin-ink)', fontSize: '10.5px', fontWeight: 700, letterSpacing: '.02em', padding: '5px 9px', borderRadius: '8px', whiteSpace: 'nowrap', boxShadow: '0 6px 16px rgba(0,0,0,.28)' }}>{b.pinLabel}</div>
                  <div style={{ fontSize: '8px', letterSpacing: '.18em', color: 'var(--pin)', fontWeight: 700, marginTop: '3px', opacity: .85 }}>LOCKED IN</div>
                  <div style={{ width: '1px', height: '14px', background: 'var(--pin)', opacity: .55, marginTop: '2px' }} />
                </div>
              )}
              {b.showTrend && (
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: '34px', height: b.h + 'px', zIndex: 3 }}>
                  <Plume trend={b.trend} />
                </div>
              )}
              <div onClick={() => { setSelectedId(b.id); setCheckin(null); }} style={{ position: 'relative', zIndex: 5, width: '100%', height: b.h + 'px', cursor: 'pointer', borderRadius: '5px 5px 0 0', background: 'linear-gradient(180deg,var(--building-top),var(--building))', boxShadow: 'inset 0 0 0 1px var(--stroke), 0 -2px 30px rgba(0,0,0,.14)', overflow: 'hidden', transition: 'transform .25s ease' }}>
                {b.halo && <div style={{ position: 'absolute', inset: '-40% -30%', background: 'radial-gradient(50% 55% at 50% 60%, var(--glow), transparent 70%)', animation: 'sk-glow 4.5s ease-in-out infinite', pointerEvents: 'none' }} />}
                <div style={{ position: 'relative', height: '100%' }}><Grid activity={b.activity} h={b.h} flavor={flavor} /></div>
                {b.id === selectedId && <div style={{ position: 'absolute', inset: 0, borderRadius: '5px 5px 0 0', boxShadow: 'inset 0 0 0 2px var(--accent)', pointerEvents: 'none' }} />}
              </div>
              <div style={{ marginTop: '18px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', width: '126px' }}>
                <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'var(--card)', border: '1px solid var(--stroke)', color: 'var(--ink)', fontSize: '10.5px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>{b.rank}</div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink)', lineHeight: 1.25, textWrap: 'balance' as CSSProperties['textWrap'] }}>{b.name}</div>
                <div style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>{b.lastMoved}</div>
              </div>
            </div>
          ))}
        </div>

        {forecastOn && drift && (
          <div style={{ position: 'absolute', left: '30px', bottom: '96px', zIndex: 8, width: '290px', background: 'var(--card)', border: '1px solid var(--card-bd)', borderRadius: '14px', padding: '15px 17px', backdropFilter: 'blur(10px)', boxShadow: '0 18px 46px rgba(0,0,0,.34)', animation: 'sk-float .5s ease both' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: 'var(--accent)' }} />
              <div style={{ fontSize: '11px', letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, color: 'var(--ink)' }}>{drift.title}</div>
            </div>
            <div style={{ fontFamily: "'Newsreader',Georgia,serif", fontSize: '16px', lineHeight: 1.4, color: 'var(--ink)', marginTop: '9px' }}>{drift.body}</div>
            <div style={{ fontSize: '10.5px', color: 'var(--ink-soft)', marginTop: '9px' }}>pulled from your own logged activity</div>
          </div>
        )}

        {sel && (
          <div style={{ position: 'absolute', top: '96px', right: '22px', zIndex: 9, width: '262px', background: 'var(--card)', border: '1px solid var(--card-bd)', borderRadius: '14px', padding: '16px 17px', backdropFilter: 'blur(12px)', boxShadow: '0 20px 50px rgba(0,0,0,.4)', animation: 'sk-rise .3s ease both' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
              <div style={{ fontSize: '15.5px', fontWeight: 700, color: 'var(--ink)' }}>{sel.name}</div>
              <div onClick={() => { setSelectedId(null); setCheckin(null); }} style={{ cursor: 'pointer', color: 'var(--ink-soft)', fontSize: '16px', lineHeight: 1, padding: '2px 4px' }}>×</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', marginTop: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}><span style={{ color: 'var(--ink-soft)' }}>Stated priority</span><span style={{ color: 'var(--ink)', fontWeight: 600 }}>#{sel.rank}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}><span style={{ color: 'var(--ink-soft)' }}>Last activity</span><span style={{ color: 'var(--ink)', fontWeight: 600 }}>{sel.lastMoved}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}><span style={{ color: 'var(--ink-soft)' }}>Sessions logged</span><span style={{ color: 'var(--ink)', fontWeight: 600 }}>{sel.sessions}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}><span style={{ color: 'var(--ink-soft)' }}>Check-in threshold</span><span style={{ color: 'var(--ink)', fontWeight: 600 }}>{sel.threshold}</span></div>
            </div>
            <div style={{ fontFamily: "'Newsreader',Georgia,serif", fontSize: '13.5px', lineHeight: 1.45, color: 'var(--ink)', opacity: .86, marginTop: '13px', paddingTop: '12px', borderTop: '1px solid var(--stroke)' }}>{sel.note}</div>

            {sel.showCheckin && (
              <div style={{ marginTop: '13px', padding: '12px 13px', borderRadius: '11px', background: 'var(--fog)', border: '1px solid var(--stroke)' }}>
                <div style={{ fontSize: '12.5px', color: 'var(--ink)', lineHeight: 1.4 }}>{sel.checkinText}</div>
                {!checkin ? (
                  <div style={{ display: 'flex', gap: '8px', marginTop: '11px' }}>
                    <div onClick={() => setCheckin('Kept at #' + sel.rank + '.')} style={{ cursor: 'pointer', flex: 1, textAlign: 'center', fontSize: '12px', fontWeight: 600, padding: '8px', borderRadius: '9px', background: 'var(--accent)', color: '#fff' }}>Yes, keep it</div>
                    <div onClick={() => { setCheckin('Opening priority view to reorder…'); onRequestReorder?.(); }} style={{ cursor: 'pointer', flex: 1, textAlign: 'center', fontSize: '12px', fontWeight: 600, padding: '8px', borderRadius: '9px', background: 'transparent', border: '1px solid var(--stroke)', color: 'var(--ink)' }}>Reorder</div>
                  </div>
                ) : (
                  <div style={{ fontSize: '12px', color: 'var(--ink)', marginTop: '10px', display: 'flex', alignItems: 'center', gap: '7px' }}><span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent)' }} />{checkin}</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ position: 'relative', zIndex: 6, padding: '20px 30px 26px', borderTop: '1px solid var(--stroke)', background: 'var(--card)', backdropFilter: 'blur(8px)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ maxWidth: '600px' }}>
            <div style={{ fontFamily: "'Newsreader',Georgia,serif", fontStyle: 'italic', fontSize: '21px', lineHeight: 1.34, color: 'var(--ink)', textWrap: 'pretty' as CSSProperties['textWrap'] }}>
              {truth.pre}<span style={{ fontStyle: 'normal', fontWeight: 600 }}>{truth.aName}</span>{truth.mid}<span style={{ fontStyle: 'normal', fontWeight: 600 }}>{truth.bName}</span>{truth.post}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '10.5px', color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}><span style={{ width: '9px', height: '9px', borderRadius: '2px', background: 'var(--win-on)', boxShadow: '0 0 6px var(--glow)' }} />lit = recent activity</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}><span style={{ color: 'var(--ink)', fontWeight: 700 }}>←</span>left = higher stated priority</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}><span style={{ width: '9px', height: '9px', borderRadius: '50%', background: 'var(--fog)' }} />fog = forecast trend</div>
          </div>
        </div>
      </div>
    </div>
  );
}
