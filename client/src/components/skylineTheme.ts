export type Flavor = 'day' | 'dusk' | 'night';
export type ThemeVars = Record<string, string>;

export function flavorForTime(d: Date): Flavor {
  const h = d.getHours() + d.getMinutes() / 60;
  if (h >= 6 && h < 16.5) return 'day';
  if ((h >= 16.5 && h < 19.5) || (h >= 5 && h < 6)) return 'dusk';
  return 'night';
}

const DUSK: ThemeVars = {
  '--sky': 'linear-gradient(180deg,#1e2650 0%,#463c78 36%,#985a84 68%,#e6996b 100%)',
  '--ink': '#fbeee9', '--ink-soft': 'rgba(250,232,224,0.74)',
  '--building': '#2c2447', '--building-top': '#3b3160',
  '--win-on': '#ffce87', '--win-off': 'rgba(90,70,110,0.30)',
  '--glow': 'rgba(255,180,120,0.62)', '--accent': '#8aa6e4',
  '--track-off': 'rgba(255,235,220,0.28)', '--fog': 'rgba(255,222,202,0.24)',
  '--pin': '#fff2e6', '--pin-ink': '#4a2740',
  '--card': 'rgba(38,26,56,0.80)', '--card-bd': 'rgba(255,205,175,0.26)', '--stroke': 'rgba(255,215,190,0.18)',
};
const DAY: ThemeVars = {
  '--sky': 'linear-gradient(180deg,#8fc4ea 0%,#b6dcf3 48%,#e4f2fb 100%)',
  '--ink': '#16233a', '--ink-soft': 'rgba(30,52,84,0.62)',
  '--building': '#aec1d5', '--building-top': '#c6d5e3',
  '--win-on': '#356199', '--win-off': 'rgba(120,145,175,0.26)',
  '--glow': 'rgba(70,130,200,0.4)', '--accent': '#2f6bb0',
  '--track-off': 'rgba(60,90,130,0.22)', '--fog': 'rgba(255,255,255,0.62)',
  '--pin': '#1f5fae', '--pin-ink': '#ffffff',
  '--card': 'rgba(255,255,255,0.92)', '--card-bd': 'rgba(40,80,130,0.18)', '--stroke': 'rgba(40,80,130,0.14)',
};
const NIGHT: ThemeVars = {
  '--sky': 'linear-gradient(180deg,#050b18 0%,#0a1b36 52%,#123259 100%)',
  '--ink': '#eaf1fb', '--ink-soft': 'rgba(206,222,245,0.64)',
  '--building': '#0f2647', '--building-top': '#16345f',
  '--win-on': '#ffd39a', '--win-off': 'rgba(130,160,200,0.10)',
  '--glow': 'rgba(255,196,130,0.55)', '--accent': '#6fa8e6',
  '--track-off': 'rgba(150,180,220,0.25)', '--fog': 'rgba(206,224,246,0.20)',
  '--pin': '#eaf3ff', '--pin-ink': '#0c2245',
  '--card': 'rgba(9,22,44,0.82)', '--card-bd': 'rgba(140,175,220,0.24)', '--stroke': 'rgba(150,180,220,0.16)',
};

export function themeFor(flavor: Flavor): ThemeVars {
  return flavor === 'night' ? NIGHT : flavor === 'dusk' ? DUSK : DAY;
}
