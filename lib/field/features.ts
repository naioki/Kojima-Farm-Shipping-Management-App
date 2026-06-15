import 'server-only'
import { getSetting } from '@/lib/settings'
import { STAFF_FEATURE_KEYS } from '@/lib/settings-spec'

/**
 * 現場（スタッフ）機能トグルの解決（サーバ専用）。
 * 既定は全OFF。出荷ステータス更新はトグル対象外で常時可能。
 * admin は role 側で常に全許可するため、ここはスタッフの可視性・権限判定に使う。
 */
export interface StaffFeatures {
  ocr: boolean
  createOrder: boolean
  reportSpec: boolean
  approve: boolean
}

export async function getStaffFeatures(): Promise<StaffFeatures> {
  const [ocr, createOrder, reportSpec, approve] = await Promise.all([
    getSetting(STAFF_FEATURE_KEYS.ocr),
    getSetting(STAFF_FEATURE_KEYS.createOrder),
    getSetting(STAFF_FEATURE_KEYS.reportSpec),
    getSetting(STAFF_FEATURE_KEYS.approve),
  ])
  return {
    ocr: ocr === 'on',
    createOrder: createOrder === 'on',
    reportSpec: reportSpec === 'on',
    approve: approve === 'on',
  }
}

/** admin はすべて許可。staff はフラグに従う。1関数で可視性を判定する。 */
export function canStaffUse(
  feature: keyof StaffFeatures,
  role: 'admin' | 'staff',
  features: StaffFeatures,
): boolean {
  return role === 'admin' || features[feature]
}
