-- ヨークのメール識別子（統合2C・影実行の前提）
--
-- ヨークの注文は社長が「7/3ヨーク」等の件名で転送してくる運用のため、送信元アドレスでは
-- 判別できず件名キーワードで取引先を特定する（lib/ingestion/match-customer.ts・マスタ駆動）。
-- 送信元アドレスで判別できる取引先は channel_identifiers.email に登録すればよい。
-- 冪等: subject_keywords が未設定のときのみ初期値を入れる（手動変更を上書きしない）。

UPDATE customers
   SET channel_identifiers = channel_identifiers || '{"subject_keywords":["ヨーク"]}'::jsonb
 WHERE name = 'ヨーク'
   AND NOT (channel_identifiers ? 'subject_keywords');
