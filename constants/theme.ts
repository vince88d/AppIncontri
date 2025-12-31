import { Platform } from 'react-native';

export const PastelPalette = ['#98FF98', '#8A2BE2', '#FF7F50', '#DDF3F5', '#E4D8F4', '#FFDFF6'];

export const Colors = {
  light: {
    text: '#2D2D2D',
    background: '#F8F9FA',
    card: '#FDFDFD',
    muted: '#5F5F5F',
    border: '#E1E4E8',
    tint: '#FF7F50',
    accent: '#8A2BE2',
  },
  dark: {
    text: '#F4F4F4',
    background: '#121212',
    card: '#1A1A1A',
    muted: '#9A9A9A',
    border: '#2A2A2A',
    tint: '#FF7F50',
    accent: '#8A2BE2',
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
