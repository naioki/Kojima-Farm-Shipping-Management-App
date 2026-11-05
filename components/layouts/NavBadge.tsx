/** メニュー項目の未処理件数バッジ。0・未指定は何も出さない（色だけに頼らず数字で示す）。 */
export function NavBadge({ count }: { count?: number }) {
  if (!count || count <= 0) return null
  return (
    <span
      className="ml-auto inline-flex min-w-[1.375rem] shrink-0 items-center justify-center rounded-full bg-alert px-1.5 text-xs font-bold leading-5 text-white"
      aria-label={`未処理 ${count} 件`}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}
