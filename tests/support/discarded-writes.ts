/**
 * 「supabase の書き込みを await して結果を受け取らずに捨てる文」を見つける静的走査
 * （tests/no-discarded-writes.test.ts から使う。engineering.md §5・CLAUDE.md NEVER swallow errors）。
 *
 * supabase-js は失敗しても例外を投げず `{ error }` を返すため、
 *   await admin.from('x').update(...).eq('id', id)
 * のように結果を捨てると、失敗しても誰も気づかない。
 *
 * 検知する形: 文の先頭にある `await <式>` で、
 *   - 式が supabase のチェーン（`admin.from(...)` 等）で、`.insert( / .update( / .upsert( / .delete(` を含む
 *   - 式が `<client>.rpc(` の呼び出し
 *   - 式が `Promise.all( / Promise.allSettled(` で、中に書き込みを含む（まとめて待って結果を捨てる）
 *   - 式が `writeDroppingMissingColumns(` の呼び出し（戻り値の error を捨てる）
 * 通す形（文の先頭でない await）: `const { error } = await ...` / `return await ...` /
 * `x = await ...` / 関数の引数・配列の要素 / `runSideEffect(..., () => admin.from(...).update(...))`
 * （await しない書き込みはこの関数に渡される）/ `.then(...)` で結果を受けているもの。
 */

const WRITE_RE = /\.from\(\s*['"`][^'"`]*['"`]\s*\)[\s\S]*?\.(insert|update|upsert|delete)\(/
/** 式が supabase クライアントのチェーンで始まる（admin.from( / supabase.from( / createAdminClient().from( 等） */
const CHAIN_START_RE = /^[\w$]+(?:\(\s*\))?(?:\s*\.\s*[\w$]+(?:\(\s*\))?)*?\s*\.\s*from\(/
const RPC_RE = /^[\w$]+(?:\(\s*\))?(?:\s*\.\s*[\w$]+)*?\s*\.\s*rpc\(/
/** 書き込みをまとめて待つだけで結果を捨てる形（Promise.all / allSettled の結果を受けない） */
const PROMISE_ALL_RE = /^Promise\.(?:all|allSettled)\(/
/** 欠落列を外して再試行する書き込み（lib/supabase/missing-column.ts）。結果の error を捨てると同じく黙る */
const DROPPING_RE = /^writeDroppingMissingColumns\(/

function isDiscardedWrite(expr: string): boolean {
  if (CHAIN_START_RE.test(expr)) return WRITE_RE.test(expr)
  if (RPC_RE.test(expr)) return true
  if (PROMISE_ALL_RE.test(expr)) return WRITE_RE.test(expr)
  return DROPPING_RE.test(expr)
}

/** `await` の直前の意味のある文字（空白とコメントを除く） */
function prevSignificant(src: string, index: number): string {
  let i = index - 1
  for (;;) {
    while (i >= 0 && /\s/.test(src.charAt(i))) i--
    // 行コメント: 行頭まで戻って `//` があればその手前へ
    const lineStart = src.lastIndexOf('\n', i) + 1
    const line = src.slice(lineStart, i + 1)
    const c = line.indexOf('//')
    if (c >= 0 && !/['"`]/.test(line.slice(0, c))) {
      i = lineStart + c - 1
      continue
    }
    if (i >= 1 && src[i] === '/' && src[i - 1] === '*') {
      const open = src.lastIndexOf('/*', i - 2)
      if (open >= 0) {
        i = open - 1
        continue
      }
    }
    break
  }
  return i >= 0 ? src.charAt(i) : ''
}

/** await の後ろの式を、括弧の深さ 0 で文が終わるところまで切り出す */
function expressionAfter(src: string, start: number): string {
  let depth = 0
  let i = start
  let quote: string | null = null
  for (; i < src.length; i++) {
    const ch = src[i]
    if (quote) {
      if (ch === '\\') {
        i++
        continue
      }
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) break
      depth--
    } else if (depth === 0 && ch === ';') break
    else if (depth === 0 && ch === '\n') {
      // 次の行が `.` で始まるならメソッドチェーンの続き
      const rest = src.slice(i + 1)
      if (!/^\s*\./.test(rest)) break
    }
  }
  return src.slice(start, i)
}

/**
 * 文として捨てられている await か（文の先頭にある await）。
 * このリポジトリはセミコロンを省く書き方なので、「直前が式を続ける記号・語でなければ文の先頭」と判定する。
 *   式の続き（＝結果を受けている）: `=` `(` `,` `[` `?` `:` `&&` `||` `+` `=>` など、`return` / `yield` / `throw` / `await`
 *   文の先頭: 直前が `;` `{` `}` `)`（if/for の後）`]` 識別子・文字列の終わり（前の文の終わり）、`else` / `do`
 */
function isStatementStart(src: string, index: number): boolean {
  const prev = prevSignificant(src, index)
  if (prev === '') return true
  if ('=([,?:&|+-*/<>!%^~'.includes(prev)) return false
  const before = src.slice(Math.max(0, index - 12), index)
  if (/(?:^|[^\w$])(?:return|yield|throw|await|typeof|void|case|in|of|new)\s*$/.test(before)) return false
  return true
}

export interface DiscardedWrite {
  line: number
  text: string
}

/** ソース中の「結果を捨てている supabase の書き込み」を返す */
export function findDiscardedWrites(src: string): DiscardedWrite[] {
  const hits: DiscardedWrite[] = []
  const re = /\bawait\s+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    if (!isStatementStart(src, m.index)) continue
    const expr = expressionAfter(src, m.index + m[0].length).trim()
    if (/\.then\(/.test(expr)) continue
    if (!isDiscardedWrite(expr)) continue
    hits.push({
      line: src.slice(0, m.index).split('\n').length,
      text: `await ${expr}`.replace(/\s+/g, ' ').slice(0, 120),
    })
  }
  return hits
}
