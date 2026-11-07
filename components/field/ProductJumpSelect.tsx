'use client'

/**
 * 品目を選ぶと、その品目の週の管理へ移動するセレクト（週に予定が1つもないとき用）。
 * onChange を使うため Client Component に分ける（Server Component に書くと週の管理ページ全体がエラーになっていた）。
 */
export function ProductJumpSelect({
  action,
  week,
  products,
}: {
  action: string
  week: string
  products: { id: string; name: string }[]
}) {
  return (
    <form method="get" action={action} className="flex items-center gap-1">
      <input type="hidden" name="week" value={week} />
      <select
        name="product"
        aria-label="品目を選んで予定を入力"
        onChange={(e) => {
          if (e.target.value) e.target.form?.submit()
        }}
        defaultValue=""
        className="min-h-10 rounded-lg border border-line bg-bg-card px-2.5 text-sm font-semibold text-ink hover:bg-bg-soft focus:outline-none focus:ring-2 focus:ring-trust-100"
      >
        <option value="" disabled>
          品目を選択して予定を入力...
        </option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </form>
  )
}
