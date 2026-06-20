# UI スナップショット（再デザインの before / after）

モック画像に合わせた UI 刷新（branch `kn/ui-redesign`）の記録。

- `before/` … 刷新前の画面（公開ページのみ。認証内の画面はパスワード入力ができないため未取得。
  刷新前の完全な状態は git タグ `ui-before-redesign-2026-06-20` に保存）
  - `login.png` … 社内ログイン
  - `portal-login.png` … 取引先ポータルのログイン
- `after/` … 刷新後（dev限定の `/ui-preview`・`/ui-preview/mobile` をヘッドレスChromeで撮影）
  - `admin-dashboard.png` … 経営ダッシュボード（実データ配線・実コンポーネント）
  - `mobile-screens.png` … 出荷マトリックス／数量入力／規格報告／取引先ポータル

## 元の見た目に戻す

```bash
git checkout kn/farm-app-phase-a-g       # 刷新前のブランチ
# もしくは
git reset --hard ui-before-redesign-2026-06-20
```

## 撮り直し（ローカル）

```bash
# ローカルクローンで dev 起動後
chrome --headless=new --screenshot=out.png --window-size=1440,1500 \
  http://localhost:3000/ui-preview
```
`/ui-preview` 系は開発限定（本番ビルドでは 404）。
