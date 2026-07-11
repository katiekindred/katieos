import type { Trend } from '../types';

// The three trend words used verbatim across the app (priority list badges,
// the selected-house detail view): buzzing / steady / napping.
export function trendWord(p: { quiet: boolean; trend: Trend }): 'buzzing' | 'steady' | 'napping' {
  if (p.quiet) return 'napping';
  return p.trend === 'rising' ? 'buzzing' : 'steady';
}

export const TREND_COLORS: Record<'buzzing' | 'steady' | 'napping', { fg: string; bg: string; bd: string }> = {
  buzzing: { fg: '#4d8a5e', bg: '#eaf7ef', bd: '#cfead9' },
  steady: { fg: '#a06a2e', bg: '#fbf0e2', bd: '#f0dcc2' },
  napping: { fg: '#7d6a9e', bg: '#efe8f8', bd: '#ded2f0' },
};
