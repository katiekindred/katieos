// Per-house color: the stock village palette, plus hex helpers so any custom
// color a project picks (Project.houseColor) can derive matching shade/door
// tones the same way the stock swatches were hand-picked. Ported from the
// design prototype's HOUSE_COLORS / deriveShades / colorsFor.

export interface HouseShades { body: string; shade: string; door: string }

export const HOUSE_COLORS: HouseShades[] = [
  { body: '#f2a48c', shade: '#d97c5f', door: '#a85a3f' },
  { body: '#a8c6a1', shade: '#7fa477', door: '#5c7f55' },
  { body: '#b8a3d9', shade: '#9078b8', door: '#6a5590' },
  { body: '#f5d78e', shade: '#d9b25e', door: '#a8863f' },
  { body: '#9fc2d9', shade: '#7099b5', door: '#4f758f' },
  { body: '#e8a3b8', shade: '#c47a94', door: '#96566e' },
];

function hexToRgb(hex: string) {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map(c => c + c).join('') : m;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}
function rgbToHsl(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return { h, s, l };
}
function hslToRgb(h: number, s: number, l: number) {
  let r: number, g: number, b: number;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: r * 255, g: g * 255, b: b * 255 };
}

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

// Derives shade/door tones from any body hex, for custom colors that aren't
// one of the stock swatches (which keep their hand-picked shades).
export function deriveShades(hex: string): HouseShades {
  const norm = hex.startsWith('#') ? hex : '#' + hex;
  const { r, g, b } = hexToRgb(norm);
  const { h, s, l } = rgbToHsl(r, g, b);
  const shade = hslToRgb(h, s, Math.max(0, l - 0.16));
  const door = hslToRgb(h, Math.min(1, s * 1.05), Math.max(0, l - 0.30));
  return { body: norm.toLowerCase(), shade: rgbToHex(shade.r, shade.g, shade.b), door: rgbToHex(door.r, door.g, door.b) };
}

export function stockHexForIndex(i: number): string {
  return HOUSE_COLORS[((i % HOUSE_COLORS.length) + HOUSE_COLORS.length) % HOUSE_COLORS.length].body;
}

// A stable fallback swatch for a project with no houseColor yet, hashed from
// its id so it doesn't shift between reloads.
function hashIndex(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % HOUSE_COLORS.length;
}

// houseColor is either a hex string ("#c96f4e"), a stock palette index
// ("0".."5", written by the color picker below), or null.
export function colorsFor(houseColor: string | null | undefined, projectId: string): HouseShades {
  if (houseColor) {
    const trimmed = houseColor.trim();
    if (HEX_RE.test(trimmed)) return deriveShades(trimmed);
    const idx = Number.parseInt(trimmed, 10);
    if (!Number.isNaN(idx) && String(idx) === trimmed) {
      return HOUSE_COLORS[((idx % HOUSE_COLORS.length) + HOUSE_COLORS.length) % HOUSE_COLORS.length];
    }
  }
  return HOUSE_COLORS[hashIndex(projectId)];
}
