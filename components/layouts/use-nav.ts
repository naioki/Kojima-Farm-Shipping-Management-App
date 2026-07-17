'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { navGroupsFor, type NavGroup } from '@/components/layouts/nav-items'

/**
 * ナビの現在地判定・アコーディオン開閉を Sidebar / MobileNav で共有するフック。
 *
 * 現在地判定は「最長一致した href だけをアクティブにする」。単純な前方一致だと
 * `/admin`（ダッシュボード）が全 /admin/* ページで同時にハイライトされてしまう。
 */

const matches = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`)

/** hrefs のうち pathname に最長一致するものを返す（一致なしは null）。 */
export function findActiveHref(pathname: string, hrefs: string[]): string | null {
  let best: string | null = null
  for (const href of hrefs) {
    if (matches(pathname, href) && (best === null || href.length > best.length)) {
      best = href
    }
  }
  return best
}

export interface NavState {
  groups: NavGroup[]
  /** 最長一致で決まる現在地。aria-current とハイライトはこれと比較する。 */
  activeHref: string | null
  openGroups: Record<string, boolean>
  toggleGroup: (label: string) => void
}

export function useNavState(role: 'admin' | 'staff'): NavState {
  const pathname = usePathname()
  const groups = navGroupsFor(role)
  const activeHref = findActiveHref(
    pathname,
    groups.flatMap((g) => g.items.map((it) => it.href)),
  )

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})

  // ページ遷移のたびに現在地を含むグループを開く（ユーザーが閉じた他グループは維持）。
  useEffect(() => {
    const containing = groups.find(
      (g) => g.label && g.items.some((it) => it.href === activeHref),
    )?.label
    if (containing) setOpenGroups((p) => (p[containing] ? p : { ...p, [containing]: true }))
    // groups は role 固定の定数配列なので依存は現在地のみで十分
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeHref])

  const toggleGroup = (label: string) =>
    setOpenGroups((p) => ({ ...p, [label]: !p[label] }))

  return { groups, activeHref, openGroups, toggleGroup }
}
