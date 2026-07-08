// Notion select/status/multi-select chip colors (light theme), keyed by the
// Notion API `color` value on each option. These are looked up verbatim — never
// computed — so a "purple" here is byte-for-byte Notion's purple. Use the
// background map for the chip fill and the text map for the label; always fall
// back to `default` when a color is missing. (Dark-theme values differ — ask
// before adding them.)
import type { CSSProperties } from 'react';

export const NOTION_CHIP_BG: Record<string, string> = {
  default: 'rgba(227, 226, 224, 0.5)',
  gray:    'rgb(227, 226, 224)',
  brown:   'rgb(238, 224, 218)',
  orange:  'rgb(250, 222, 201)',
  yellow:  'rgb(253, 236, 200)',
  green:   'rgb(219, 237, 219)',
  blue:    'rgb(211, 229, 239)',
  purple:  'rgb(232, 222, 238)',
  pink:    'rgb(245, 224, 233)',
  red:     'rgb(255, 226, 221)',
};

export const NOTION_CHIP_TEXT: Record<string, string> = {
  default: 'rgb(50, 48, 44)',
  gray:    'rgb(50, 48, 44)',
  brown:   'rgb(68, 42, 30)',
  orange:  'rgb(73, 41, 14)',
  yellow:  'rgb(64, 44, 27)',
  green:   'rgb(28, 56, 41)',
  blue:    'rgb(24, 51, 71)',
  purple:  'rgb(65, 36, 84)',
  pink:    'rgb(76, 35, 55)',
  red:     'rgb(93, 23, 21)',
};

// Solid dot color, for a leading color dot instead of a filled chip.
export const NOTION_DOT: Record<string, string> = {
  default: 'rgb(85, 83, 78)',
  gray:    'rgb(166, 162, 153)',
  brown:   'rgb(159, 107, 83)',
  orange:  'rgb(217, 115, 13)',
  yellow:  'rgb(203, 145, 47)',
  green:   'rgb(68, 131, 97)',
  blue:    'rgb(51, 126, 169)',
  purple:  'rgb(144, 101, 176)',
  pink:    'rgb(193, 76, 138)',
  red:     'rgb(212, 76, 71)',
};

export const chipStyle = (color = 'default'): CSSProperties => ({
  backgroundColor: NOTION_CHIP_BG[color] ?? NOTION_CHIP_BG.default,
  color: NOTION_CHIP_TEXT[color] ?? NOTION_CHIP_TEXT.default,
});
