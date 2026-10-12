import type { ChatlyTheme } from './ChatlyTheme';

/**
 * Default theme. Colors mirror the web widget defaults so cross-platform
 * branding stays consistent out of the box.
 */
export const defaultTheme: ChatlyTheme = {
  colors: {
    primary: '#2563eb',
    onPrimary: '#ffffff',
    background: '#ffffff',
    foreground: '#0f172a',
    mutedForeground: '#64748b',
    border: '#e2e8f0',
    surface: '#f8fafc',
    danger: '#ef4444',
  },
  radius: {
    sm: 6,
    md: 10,
    lg: 16,
    bubble: 18,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
  },
  typography: {
    sizeBody: 15,
    sizeSmall: 12,
    sizeTitle: 17,
    weightRegular: '400',
    weightMedium: '500',
    weightBold: '700',
  },
};
