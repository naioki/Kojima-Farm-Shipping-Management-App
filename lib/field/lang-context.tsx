'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'

export type FieldLangMode = 'ja' | 'th'

interface FieldLangContextValue {
  langMode: FieldLangMode
  isThaiMode: boolean
  setLangMode: (mode: FieldLangMode) => void
  toggleLangMode: () => void
}

const STORAGE_KEY = 'kojima_field_lang_mode'

const FieldLangContext = createContext<FieldLangContextValue>({
  langMode: 'ja',
  isThaiMode: false,
  setLangMode: () => {},
  toggleLangMode: () => {},
})

export function FieldLangProvider({ children }: { children: React.ReactNode }) {
  const [langMode, setLangState] = useState<FieldLangMode>('ja')

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved === 'th' || saved === 'ja') {
        setLangState(saved)
      }
    } catch {
      // localStorage が使えない環境（プライベートモード等）は既定の言語のまま使う
    }
  }, [])

  const setLangMode = (mode: FieldLangMode) => {
    setLangState(mode)
    try {
      localStorage.setItem(STORAGE_KEY, mode)
    } catch {
      // 保存できなくても画面上の切り替えは効いている（次回起動時に既定へ戻るだけ）
    }
  }

  const toggleLangMode = () => {
    setLangMode(langMode === 'th' ? 'ja' : 'th')
  }

  return (
    <FieldLangContext.Provider
      value={{
        langMode,
        isThaiMode: langMode === 'th',
        setLangMode,
        toggleLangMode,
      }}
    >
      {children}
    </FieldLangContext.Provider>
  )
}

export function useFieldLang() {
  return useContext(FieldLangContext)
}
