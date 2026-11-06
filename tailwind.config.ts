import type { Config } from 'tailwindcss'

// 色は globals.css の CSS Variables を参照する。
// ここに hex を直書きしない理由：ダークモード切替を CSS 側だけで完結させるため。
// 透明度（bg-harvest-50/70 など）を効かせるため、/NN 付きのときだけ CSS 変数を color-mix で包む。
// 以前は変数をそのまま渡していたので /NN 付きのクラスは CSS が1行も出ていなかった。
// /NN なしのときは素の var() を返す（color-mix 非対応の古い端末でも通常の色は必ず出る）。
// そのために *-opacity 系のコアプラグインを切っている（bg-opacity-50 等は使っていない）。
// Tailwind の型は色に関数を受け付けないが、実行時は関数の色をサポートしている（v3）。
const c = (name: string): string =>
  (({ opacityValue }: { opacityValue?: string }) =>
    opacityValue === undefined || opacityValue === '1'
      ? `var(--${name})`
      : `color-mix(in srgb, var(--${name}) calc(${opacityValue} * 100%), transparent)`) as unknown as string

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  darkMode: 'class',
  corePlugins: {
    backgroundOpacity: false,
    textOpacity: false,
    borderOpacity: false,
    divideOpacity: false,
    placeholderOpacity: false,
    ringOpacity: false,
  },
  theme: {
    extend: {
      colors: {
        earth: {
          50: c('earth-50'), 100: c('earth-100'), 200: c('earth-200'),
          300: c('earth-300'), 400: c('earth-400'), 500: c('earth-500'),
          600: c('earth-600'), 700: c('earth-700'), 800: c('earth-800'),
          900: c('earth-900'),
        },
        harvest: {
          50: c('harvest-50'), 100: c('harvest-100'), 400: c('harvest-400'),
          500: c('harvest-500'), 600: c('harvest-600'), 700: c('harvest-700'),
        },
        trust: {
          50: c('trust-50'), 100: c('trust-100'), 400: c('trust-400'),
          500: c('trust-500'), 600: c('trust-600'), 700: c('trust-700'),
        },
        forest: {
          50: c('forest-50'), 100: c('forest-100'), 200: c('forest-200'),
          400: c('forest-400'), 500: c('forest-500'), 600: c('forest-600'),
          700: c('forest-700'), 800: c('forest-800'), 900: c('forest-900'),
        },
        grape: {
          50: c('grape-50'), 100: c('grape-100'), 200: c('grape-200'),
          500: c('grape-500'), 600: c('grape-600'), 700: c('grape-700'),
        },
        alert: { DEFAULT: c('alert'), bg: c('alert-bg') },
        warning: { DEFAULT: c('warning'), bg: c('warning-bg') },
        bg: { DEFAULT: c('bg'), soft: c('bg-soft'), card: c('bg-card') },
        ink: { DEFAULT: c('ink'), soft: c('ink-soft'), faint: c('ink-faint') },
        line: { DEFAULT: c('line'), strong: c('line-strong') },
        // 暗いパネル（ビューア・積込ヘッダー等）用。ダークモードでも反転しない（ink は反転するので暗い地には使わない）
        night: { DEFAULT: c('night'), soft: c('night-soft') },
      },
      fontFamily: {
        // フォールバックは明朝体(serif)ではなくゴシック体(sans-serif)にする。
        // カスタムフォントの読み込みが遅延・失敗した瞬間、見出しが意図せず明朝体で
        // 表示される問題があった（design.mdの「丸ゴシックで親しみやすさ」の意図に反する）。
        display: ['var(--font-display)', 'sans-serif'],
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
