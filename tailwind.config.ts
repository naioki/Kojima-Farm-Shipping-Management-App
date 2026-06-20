import type { Config } from 'tailwindcss'

// 色は globals.css の CSS Variables を参照する。
// ここに hex を直書きしない理由：ダークモード切替を CSS 側だけで完結させるため。
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        earth: {
          50: 'var(--earth-50)', 100: 'var(--earth-100)', 200: 'var(--earth-200)',
          300: 'var(--earth-300)', 400: 'var(--earth-400)', 500: 'var(--earth-500)',
          600: 'var(--earth-600)', 700: 'var(--earth-700)', 800: 'var(--earth-800)',
          900: 'var(--earth-900)',
        },
        harvest: {
          50: 'var(--harvest-50)', 100: 'var(--harvest-100)', 400: 'var(--harvest-400)',
          500: 'var(--harvest-500)', 600: 'var(--harvest-600)', 700: 'var(--harvest-700)',
        },
        trust: {
          50: 'var(--trust-50)', 100: 'var(--trust-100)', 400: 'var(--trust-400)',
          500: 'var(--trust-500)', 600: 'var(--trust-600)', 700: 'var(--trust-700)',
        },
        forest: {
          50: 'var(--forest-50)', 100: 'var(--forest-100)', 200: 'var(--forest-200)',
          400: 'var(--forest-400)', 500: 'var(--forest-500)', 600: 'var(--forest-600)',
          700: 'var(--forest-700)', 800: 'var(--forest-800)', 900: 'var(--forest-900)',
        },
        grape: {
          50: 'var(--grape-50)', 100: 'var(--grape-100)', 200: 'var(--grape-200)',
          500: 'var(--grape-500)', 600: 'var(--grape-600)', 700: 'var(--grape-700)',
        },
        alert: { DEFAULT: 'var(--alert)', bg: 'var(--alert-bg)' },
        warning: { DEFAULT: 'var(--warning)', bg: 'var(--warning-bg)' },
        bg: { DEFAULT: 'var(--bg)', soft: 'var(--bg-soft)', card: 'var(--bg-card)' },
        ink: { DEFAULT: 'var(--ink)', soft: 'var(--ink-soft)', faint: 'var(--ink-faint)' },
        line: { DEFAULT: 'var(--line)', strong: 'var(--line-strong)' },
      },
      fontFamily: {
        display: ['var(--font-display)', 'serif'],
        sans: ['var(--font-body)', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        lg: 'var(--radius-lg)',
      },
      transitionTimingFunction: {
        organic: 'var(--ease-organic)',
      },
    },
  },
  plugins: [],
}
export default config
