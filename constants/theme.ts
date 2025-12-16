import { Platform } from 'react-native';

export const PastelPalette = ['#FADADD', '#FFE5B4', '#FFF6B7', '#DDF3F5', '#E4D8F4', '#FFDFF6'];

export const Colors = {
  light: {
    text: '#111827',
    background: '#f8fafc',
    card: '#ffffff',
    muted: '#6b7280',
    border: '#e5e7eb',
    tint: '#ff9fb7',
    accent: '#9bb8ff',
  },
  dark: {
    text: '#E5E7EB',
    background: '#0d1117',
    card: '#151922',
    muted: '#9CA3AF',
    border: '#1f2430',
    tint: '#ff9fb7',
    accent: '#9bb8ff',
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
