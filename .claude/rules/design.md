---
paths:
  - "components/**"
  - "app/**/*.tsx"
  - "app/**/*.css"
  - "styles/**"
---

# UI/UX デザインルール

## デザインコンセプト
「大地と信頼」- 農業の価値（土・緑）× 企業の信頼（深青）
目標：毎日使いたくなる、Naoki が誇りに思えるシステム

## カラーパレット（CSS Variables 必須）

```css
/* 使用するCSS Variables（globals.css で定義済み） */
--color-earth-500: #b8935d;    /* プライマリ（ボタン・強調） */
--color-harvest-500: #22c55e;  /* 成功・完了 */
--color-trust-500: #0ea5e9;    /* フォーカス・リンク・情報 */
--color-alert: #dc2626;        /* エラー・警告 */
--bg-primary: #ffffff;         /* メイン背景 */
--bg-secondary: #faf9f7;       /* セカンダリ背景 */
--text-primary: #1a1410;       /* メインテキスト */
--text-secondary: #7a6854;     /* サブテキスト */
--border-color: #e4d5c5;       /* ボーダー */
```

ハードコードカラー禁止。必ず CSS Variables か Tailwind カスタムテーマを使う。

## フォント（next/font で自己ホスト、CDN <link> 禁止）
```
--font-display: 'Zen Old Mincho', serif      → 大見出し・金額の強調（和の風格）
--font-body:    'Noto Sans JP', sans-serif   → 本文・h2以下
--font-mono:    'JetBrains Mono', monospace  → 数字・金額・テーブル・コード
```
Inter / Arial / Roboto / system-ui デフォルト単体禁止。
金額表示は必ず font-mono + tabular-nums（桁が揃いスキャンしやすい）。

## コンポーネント原則

### Button
```tsx
// variants: primary | secondary | tertiary | danger
// sizes:    sm | md | lg
// 必ず isLoading 対応（処理中... + スピナー）
<Button variant="primary" size="md" isLoading={isSubmitting}>
  送信
</Button>
```

### Card
```tsx
// variants: default | glass | elevated
// interactive な Card は hover で translateY(-2px) + shadow-lg
<Card variant="elevated" interactive>
  {children}
</Card>
```

### Input / Form
```tsx
// 必ず label + error + required 対応
// フォーカス: trust-500 border + ring
// エラー: alert border + error message
<Input label="顧客名" required error={errors.name?.message} />
```

## アニメーション原則
- ページロード: `grow-in` キーフレーム（scale 0.95 → 1 + translateY 10px → 0）
- カード出現: `slide-up` キーフレーム（ステゴード delay 50ms ずつ）
- ホバー: `transform hover:-translate-y-1` + `transition-all duration-300`
- ローディング: `animate-pulse`（呼吸するような揺らぎ）
- easing: `cubic-bezier(0.34, 1.56, 0.64, 1)` を標準使用

## シャドウ
```
shadow-sm → 通常カード
shadow-md → ホバー時 / 重要カード
shadow-lg → モーダル / ドロップダウン
shadow-xl → 最前面要素
```

## レスポンシブ
- Mobile first（320px〜）
- Sidebar は lg(1024px)以上で固定表示、それ以下でハンバーガー
- タスク画面は max-w-2xl（スタッフはスマホ利用が多い）
- ダッシュボードは 1280px 以上で最適

## ダークモード
必ず `dark:` クラスを付ける。
```tsx
className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-50"
```

## アクセシビリティ（WCAG 2.1 AA）
- すべての input に `htmlFor` + `id` を必ず設定
- エラーメッセージに `aria-describedby` を設定
- インタラクティブ要素に `focus:ring-2 focus:ring-offset-2`
- 色だけで情報を伝えない（アイコン + テキスト併用）

## KPICard（経営向け）
```tsx
// variants: revenue | orders | margin | default
// change: { percent: number, period: string }
// 正 → harvest-600（緑）TrendingUp アイコン
// 負 → alert（赤）TrendingDown アイコン
<KPICard
  title="売上"
  value="¥2,500,000"
  change={{ percent: 12.3, period: "前月比" }}
  variant="revenue"
/>
```

## TaskProgressCard（スタッフ向け）
```tsx
// プログレスバー必須
// status: not_started | harvesting | packing | completed | delayed
// delayed → alert色（赤）
// completed → harvest-500（緑）
```

## 禁止事項
- ハードコードカラー（#fff や rgb()）禁止
- inline styles 禁止（Tailwind か CSS Variables を使う）
- Inter / Arial 単体フォント禁止
- 紫グラデーション背景禁止
- cookie-cutter な AI デザイン禁止
- margin/padding の magic number 禁止（スペーシングスケール使用）
