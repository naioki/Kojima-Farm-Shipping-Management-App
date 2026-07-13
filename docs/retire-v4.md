# 統合2E v4退役 手順書（v4アプリ停止・kojima-farm-backend はバックアップ保持）

統合フェーズの最終工程。統合2A〜2D で「受注取り込み → 承認 → 出荷帳票 → 印刷 → 配送 → 請求」を
本アプリ（`kojima-farm-order-app`）に集約し終えた前提で、旧 v4 アプリを退役させる。

**方針（オーナー決定事項・厳守）**
- チャットボット（Discord / LINE WORKS）は**移植したが起動しない**。承認・印刷・取込は
  すべて Web アプリ（`/admin/approvals`・`/field/print`・`/admin/inbox`）で行う。v4 の Discord
  自動化は「本アプリの Web UI」で置き換える（＝機能移植ではなく運用移行）。
- **`kojima-farm-backend` は絶対に停止・上書き・削除しない**。バックアップとして常時残す。
- コストは最優先。Cloud Run は `--min-instances=0`・**CPU常時割当は使わない**（アイドル時ほぼ$0）。
- すべての手順に即時ロールバックを用意する。退役は出荷の少ない日に行う。

すべての `gcloud` コマンドはオーナーが Cloud Shell 等で実行する（このリポジトリの担当は
サンドボックスから GCP に接続できないため、コマンドと手順の提供のみ）。

---

## Cloud Run サービス一覧（退役対象の切り分け）

| サービス | 実体 | 退役時の扱い |
|---|---|---|
| `kojima-farm-order-app` | 本アプリ（Next.js 統合版） | **本番として継続**。触らない |
| `kojima-farm-backend` | v4 の FastAPI バックエンド（現在も稼働） | **バックアップとして保持**。停止・削除・上書き禁止 |
| `kojima-farm-app-v4-frontend` | v4 の Next.js フロント | 退役対象（当面は参照用に休眠 → 後日削除） |
| `kojima-farm-app-v4-backend` | 本統合作業中に別途デプロイした未使用の重複バックエンド | 退役対象（未使用なので停止/削除して可） |

> 補足: v4 フロントの `.env.production` は `NEXT_PUBLIC_API_URL` が `kojima-farm-backend` を指している。
> つまり v4 が実際に叩いているのは `kojima-farm-backend` であり、`kojima-farm-app-v4-backend` は
> どの本番からも参照されていない（だから安全に止められる）。

---

## 0. 事前チェックリスト（すべて満たしてから着手）

- [ ] 統合2D 切替（[cutover-2d.md](cutover-2d.md)）後、本アプリだけで1週間以上 安定稼働している
- [ ] 影実行（`/api/cron/shadow-diff`）の差分が **3営業日連続ゼロ**
- [ ] 現場が **Web アプリで承認・印刷・取込を実際に回せている**こと（Discord を使わない運用の確認）
  - 承認: `/admin/approvals`
  - 印刷: `/field/print` の「事務所で自動印刷」→ 紙が出る
  - 取込: `/admin/inbox` の「取り込む」→ 受信トレイに反映される
- [ ] v4 の Cloud Run・DB には一切書き込みが入っていない（読み取り専用化済み＝2D §3）
- [ ] `kojima-farm-backend` を退役対象に**含めていない**ことを声に出して確認

---

## 1. v4 の書き込み経路がすべて停止していることの確認

2D で大半は停止済み。取りこぼしがないか最終確認する。

1. v4 側のメール取得・自動承認・Discord 自動化を叩く **Cloud Scheduler ジョブ**を一覧し、無効化:
   ```bash
   gcloud scheduler jobs list --location asia-northeast1
   # v4 関連（メール取得・print・discord）のジョブを pause
   gcloud scheduler jobs pause <JOB_NAME> --location asia-northeast1
   ```
2. v4 リポジトリに紐づく **Cloud Build トリガー**があれば無効化（自動再デプロイ防止）:
   ```bash
   gcloud builds triggers list
   gcloud builds triggers describe <TRIGGER_ID>   # 対象が naioki/kojima-farm-app-v4 か確認
   # コンソール または: gcloud builds triggers ... で無効化
   ```
3. 本アプリ側は取り込みを **手動運用**（`/admin/inbox`「取り込む」）。5分ポーリングの
   Cloud Scheduler は**作らない**（コスト方針）。`AUTO_APPROVE_ENABLED` は影実行ゼロ確認後のみ on。

- ロールバック: pause したジョブ／トリガーを resume・有効化するだけ。

---

## 2. v4 データベースのバックアップ取得（停止前に必ず）

v4 の Supabase プロジェクト（`hynedtzwxuinruxsxvlm`）のデータは**消さない**。停止前に静的エクスポートを取る。

- Supabase ダッシュボード or `pg_dump` で主要テーブル（orders / order_lines / customers /
  products / ocr_verifications / print_jobs 等）を **CSV および SQL** でエクスポート
- エクスポート物を Cloudflare R2（本アプリの原本保管先）に `backups/v4/YYYYMMDD/` で保管（税務保存に準拠）
- v4 Supabase プロジェクト自体は**当面そのまま残す**（Cloud Run を止めても DB は生かしておく）

---

## 3. v4 フロントの読み取り専用・休眠化（過去参照は残す）

請求・注文履歴の参照用に、v4 フロントは**しばらく残す**（2D §3 と同方針）。

- `kojima-farm-app-v4-frontend` は `--min-instances=0` のまま（アクセスが無ければ課金ほぼ$0）
  ```bash
  gcloud run services describe kojima-farm-app-v4-frontend --region asia-northeast1 \
    --format="value(spec.template.metadata.annotations)"   # min-instances=0 を確認（read-only）
  ```
- 書き込み UI（承認・取込・Discord トリガー）が全停止していることを確認（§1 済みなら OK）
- 参照が完全に不要と判断できた段階で §5 の削除に進む

---

## 4. 未使用バックエンド `kojima-farm-app-v4-backend` の停止/削除

どの本番からも参照されていない重複サービス（前掲の補足参照）。安全に停止できる。

1. まず**参照ゼロの最終確認**（read-only）:
   ```bash
   # v4 フロントが指す API を確認（kojima-farm-backend であること＝この重複は未参照）
   gcloud run services describe kojima-farm-app-v4-frontend --region asia-northeast1 \
     --format="value(spec.template.spec.containers[0].env)"
   ```
2. トラフィックを止める（まずは削除せず無効化＝ロールバック容易）:
   ```bash
   # 未認証アクセスを外して事実上停止（コンソールでも可）
   gcloud run services update kojima-farm-app-v4-backend --region asia-northeast1 --no-allow-unauthenticated
   ```
3. 1〜2週間、本番に何の影響も無いことを確認できたら削除:
   ```bash
   gcloud run services delete kojima-farm-app-v4-backend --region asia-northeast1
   ```

- ロールバック: 削除前なら `--allow-unauthenticated` に戻すだけ。削除後は当該
  `cloudbuild.yaml`（`backend/cloudbuild.yaml`）から再デプロイ可能。

> ⚠️ このステップの対象は **`kojima-farm-app-v4-backend`** だけ。名前が似ている
> **`kojima-farm-backend`（バックアップ）には一切触れない**。コマンド実行前にサービス名を指差し確認する。

---

## 5. v4 フロントの最終削除（参照不要が確定してから・任意）

過去データ参照が完全に不要になったら:
```bash
gcloud run services delete kojima-farm-app-v4-frontend --region asia-northeast1
```
- v4 Supabase プロジェクトは**この段階でも残す**（バックアップ＋万一の参照用）。停止するとしても
  「Pause project」まで（削除しない）。
- ロールバック: v4 リポジトリの `cloudbuild.yaml` から再デプロイ。

---

## 6. 完了条件

- [ ] 本アプリだけで「受信 → 承認 → 出荷一覧 → 帳票印刷 → 配送 → 請求」が支障なく回っている
- [ ] v4 フロント／`kojima-farm-app-v4-backend` が停止（または削除）済み
- [ ] **`kojima-farm-backend` は稼働継続**（バックアップとして残っている）
- [ ] v4 DB のエクスポートを R2 に保管済み
- [ ] 現場から未解決の指摘がない

---

## やってはいけないこと（事故防止）

- ❌ `kojima-farm-backend` の停止・削除・イメージ上書き・環境変数変更
- ❌ v4 Supabase プロジェクト（`hynedtzwxuinruxsxvlm`）の削除
- ❌ バックアップ取得前の Cloud Run 削除
- ❌ 影実行の差分ゼロ3営業日を確認する前の `AUTO_APPROVE_ENABLED` = on
- ❌ コスト削減方針に反する「CPU常時割当」「min-instances≥1」「5分ポーリング cron」の新規設定

---

## 付記: 休眠している Discord ボットのコードについて

本アプリには統合2E で実装した Discord Interactions ボット（`app/api/chat/discord/`・`lib/chat/`）が
含まれるが、オーナー判断で**起動しない**（`DISCORD_PUBLIC_KEY` 未設定のため webhook は 401 を返すだけ・
通常運用に影響なし）。将来チャット操作が必要になれば、設定画面の「チャット連携」にトークン類を
入れ、Discord Developer Portal で Interactions URL（`/api/chat/discord`）を登録するだけで有効化できる。
退役作業では特に何もしなくてよい。
