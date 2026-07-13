// vitest 用スタブ。'server-only' は Next のビルド時のみ提供される副作用インポートで、
// 実行時パッケージが存在しないため vitest では解決できない。テストでは空モジュールに
// エイリアスして、server 専用モジュール（import 'server-only'）を Node 環境で読み込めるようにする。
export {}
