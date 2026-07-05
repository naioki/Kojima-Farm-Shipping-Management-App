# 統合2D 切替手順書（現場切替・print_jobs移設・v4読み取り専用化）

前提: 統合2C の影実行で **差分ゼロが3営業日連続** していること（毎朝のDiscordレポートで確認）。
すべての手順に即時ロールバックがある。切替は出荷の少ない日の午後に行うのが安全。

## 0. 事前チェックリスト
- [ ] 影実行レポートが3営業日連続 ✅（/api/cron/shadow-diff）
- [ ] 現場が /field/print で試し刷り済み・帳票レイアウトに現場OKが出ている
- [ ] 設定 `INTEGRATION_CUTOVER_DATE` に切替日を入力（記録用）
- [ ] v4 の Cloud Run・DB には一切手を入れていない（ロールバック余地の確認）

## 1. 印刷エージェントの接続先切替（所要5分・無改修）
事務所の常駐PC（print_agent.py）の `.env` を書き換えて再起動するだけ。

```bash
# 旧（v4）           SUPABASE_URL=https://hynedtzwxuinruxsxvlm.supabase.co
# 新（kojima-noen）  SUPABASE_URL=https://ggenmkcdwzpydbkpxpms.supabase.co
#                    SUPABASE_SERVICE_ROLE_KEY=（kojima-noen の service_role キー）
sudo systemctl restart print-agent   # systemd 運用の場合
```

- 動作確認: /field/print の「事務所で自動印刷」を押す → キュー一覧が
  「じゅんばん待ち → 印刷中… → 印刷ずみ」と進み、紙が出ること。
- **切替週は旧エージェントを別PCで併走させてもよい**（v4側の印刷も引き続き動く）。
- ロールバック: `.env` を旧値に戻して再起動（1分）。

## 2. 取り込みの一本化（v4のメール取得を停止）
二重取り込み防止のため、**本アプリの自動承認を有効化する前に** v4側を止める。

1. v4 の Discord 自動化（メール取得コマンド/定期実行）を停止
2. v4 のメール取得を叩いている定期実行（Cloud Scheduler / cron）があれば無効化
3. 本アプリの設定で `AUTO_APPROVE_ENABLED` を on（高確信のみ自動承認。低確信は従来どおり受信トレイ）
4. 影実行はそのまま数日残してよい（v4に新規データが入らなくなるので差分は「v4に無い」側に出る。
   確認が済んだら `V4_SUPABASE_URL` を空にして影実行OFF）

- ロールバック: v4 の定期実行を再開し、本アプリの `AUTO_APPROVE_ENABLED` を off に戻す。

## 3. v4 読み取り専用化（切替1週間の安定稼働後）
- v4 フロントは過去データ参照用に残す（請求・注文履歴の凍結参照。design doc §6-2）
- v4 の書き込み経路（メール取得・承認・Discord自動化）が全停止していることを確認
- v4 DB のエクスポート（CSV/SQL）を取得し R2 へ保管

## 4. 完了条件
- 本アプリだけで「メール受信 → 承認 → 出荷一覧 → 帳票印刷（手動/自動）→ 配送 → 請求」が1週間回る
- 現場から帳票・画面についての未解決の指摘がない

→ 達成後、統合2E（Discord自動化の本アプリ移植・v4 Cloud Run 停止）へ。
