export type Flavor = 'day' | 'dusk' | 'night';

export interface ThemeDef {
  vars: Record<string, string>; // spread as CSS custom properties (--sky, --ink, ...)
  tint: string; // overlay wash on house bodies
  winOnGlow: boolean;
  pin: string;
  pinInk: string;
}

export function flavorForTime(d: Date): Flavor {
  const h = d.getHours() + d.getMinutes() / 60;
  if (h >= 6 && h < 16.5) return 'day';
  if ((h >= 16.5 && h < 19.5) || (h >= 5 && h < 6)) return 'dusk';
  return 'night';
}

// Warm village palette, ported from the design prototype's THEMES.
const DAY: ThemeDef = {
  vars: {
    '--sky': 'linear-gradient(180deg,#ffe3b3 0%,#ffd9c2 52%,#fff0dc 100%)',
    '--ink': '#5a4636', '--ink-soft': 'rgba(90,70,54,0.64)',
    '--win-on': '#8a6a3a', '--win-off': 'rgba(255,255,255,0.45)',
    '--glow': 'rgba(255,205,120,0.4)', '--accent': '#c96f4e',
    '--track-off': 'rgba(120,90,60,0.22)', '--fog': 'rgba(255,255,255,0.6)',
    '--card': 'rgba(255,252,245,0.9)', '--card-bd': 'rgba(150,110,70,0.22)', '--stroke': 'rgba(150,110,70,0.16)',
  },
  tint: 'transparent', winOnGlow: false, pin: '#c96f4e', pinInk: '#ffffff',
};
const DUSK: ThemeDef = {
  vars: {
    '--sky': 'linear-gradient(180deg,#6f5da5 0%,#b585ae 48%,#f7b98d 100%)',
    '--ink': '#fff3ea', '--ink-soft': 'rgba(255,240,228,0.74)',
    '--win-on': '#ffdf9e', '--win-off': 'rgba(60,40,80,0.28)',
    '--glow': 'rgba(255,190,120,0.6)', '--accent': '#e08a5e',
    '--track-off': 'rgba(255,235,220,0.3)', '--fog': 'rgba(255,222,202,0.24)',
    '--card': 'rgba(58,42,84,0.78)', '--card-bd': 'rgba(255,205,175,0.3)', '--stroke': 'rgba(255,215,190,0.22)',
  },
  tint: 'linear-gradient(180deg,rgba(50,35,85,0.32),rgba(50,35,85,0.42))', winOnGlow: true,
  pin: '#fff3ea', pinInk: '#5a3820',
};
const NIGHT: ThemeDef = {
  vars: {
    '--sky': 'linear-gradient(180deg,#241f45 0%,#3a2f63 55%,#5a4485 100%)',
    '--ink': '#f5eefe', '--ink-soft': 'rgba(230,218,250,0.66)',
    '--win-on': '#ffd98f', '--win-off': 'rgba(30,22,55,0.4)',
    '--glow': 'rgba(255,200,130,0.6)', '--accent': '#a98fd6',
    '--track-off': 'rgba(200,180,240,0.28)', '--fog': 'rgba(210,195,245,0.2)',
    '--card': 'rgba(38,30,66,0.82)', '--card-bd': 'rgba(180,160,225,0.3)', '--stroke': 'rgba(185,165,230,0.22)',
  },
  tint: 'linear-gradient(180deg,rgba(25,18,50,0.5),rgba(25,18,50,0.6))', winOnGlow: true,
  pin: '#f5eefe', pinInk: '#2c2452',
};

export function themeFor(flavor: Flavor): ThemeDef {
  return flavor === 'night' ? NIGHT : flavor === 'dusk' ? DUSK : DAY;
}
