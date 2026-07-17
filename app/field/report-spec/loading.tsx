import { GenericPageSkeleton } from '@/components/skeletons'

/** 現場向け汎用の読み込み中スケルトン（スマホ幅・見出し + カード列）。 */
export default function Loading() {
  return <GenericPageSkeleton className="max-w-2xl" cards={4} />
}
