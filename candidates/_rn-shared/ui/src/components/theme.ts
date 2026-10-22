// Visual specification (design §8.2): light theme, system font, one accent colour, no images, shadows or gradients.
export const colors = {
  background: '#FFFFFF',
  text: '#111111',
  muted: '#5F6368',
  border: '#E0E0E0',
  neutral: '#E6E8EB',
  accent: '#2F6FEB',
  onAccent: '#FFFFFF',
  digest: '#E4E4E4',
} as const;

/** Normative vertical bands of the List screen in dp/pt (design §8.2). */
export const bands = {
  header: 56,
  statusRow: 32,
  summary: 48,
  row: 72,
} as const;
