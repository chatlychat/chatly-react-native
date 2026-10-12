/**
 * Theme contract. Mirrors the variables exposed by the web widget so designers
 * can theme web + mobile from one palette.
 */
export interface ChatlyTheme {
  colors: {
    primary: string;
    onPrimary: string;
    background: string;
    foreground: string;
    mutedForeground: string;
    border: string;
    surface: string;
    danger: string;
  };
  radius: {
    sm: number;
    md: number;
    lg: number;
    bubble: number;
  };
  spacing: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
  };
  typography: {
    sizeBody: number;
    sizeSmall: number;
    sizeTitle: number;
    weightRegular: '400';
    weightMedium: '500';
    weightBold: '700';
  };
}
