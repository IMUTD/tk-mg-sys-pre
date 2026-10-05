import type { ProSettings } from "@ant-design/pro-components"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"

import { APP_NAME } from "./product"

export type LayoutMode = NonNullable<ProSettings["layout"]>
export type ContentWidth = NonNullable<ProSettings["contentWidth"]>
export type NavTheme = NonNullable<ProSettings["navTheme"]>
export type SiderMenuType = NonNullable<ProSettings["siderMenuType"]>

export type UiPreferences = {
  readonly colorPrimary: string
  readonly colorWeak: boolean
  readonly contentWidth: ContentWidth
  readonly fixSiderbar: boolean
  readonly fixedHeader: boolean
  readonly layout: LayoutMode
  readonly navTheme: NavTheme
  readonly siderCollapsed: boolean
  readonly siderMenuType: SiderMenuType
  readonly splitMenus: boolean
}

type UiPreferencesContextValue = {
  readonly applyLayoutSettings: (settings: ProSettings) => void
  readonly layoutSettings: ProSettings
  readonly openSettings: () => void
  readonly preferences: UiPreferences
  readonly settingsOpen: boolean
  readonly setPreferences: (patch: Partial<UiPreferences>) => void
  readonly setSettingsOpen: (open: boolean) => void
}

type StoredUiPreferences = {
  readonly colorPrimary?: unknown
  readonly colorScheme?: unknown
  readonly colorWeak?: unknown
  readonly contentWidth?: unknown
  readonly fixedHeader?: unknown
  readonly fixSiderbar?: unknown
  readonly layout?: unknown
  readonly navTheme?: unknown
  readonly siderCollapsed?: unknown
  readonly siderMenuType?: unknown
  readonly splitMenus?: unknown
}

const storageKey = "tk-mg.ui-preferences"

export const defaultUiPreferences: UiPreferences = {
  colorPrimary: "#1677ff",
  colorWeak: false,
  contentWidth: "Fluid",
  fixSiderbar: true,
  fixedHeader: false,
  layout: "side",
  navTheme: "light",
  siderCollapsed: false,
  siderMenuType: "sub",
  splitMenus: false,
}

class MissingUiPreferencesError extends Error {
  readonly name = "MissingUiPreferencesError"

  constructor() {
    super("UiPreferencesProvider is required")
  }
}

const isLayoutMode = (value: unknown): value is LayoutMode =>
  value === "mix" || value === "side" || value === "top"

const isContentWidth = (value: unknown): value is ContentWidth =>
  value === "Fixed" || value === "Fluid" || value === "fixed" || value === "fluid"

const isNavTheme = (value: unknown): value is NavTheme => value === "light" || value === "realDark"

const isSiderMenuType = (value: unknown): value is SiderMenuType =>
  value === "sub" || value === "group"

const normalizeContentWidth = (value: unknown): ContentWidth => {
  if (value === "Fixed" || value === "fixed") return "Fixed"
  return "Fluid"
}

const normalizeNavTheme = (record: StoredUiPreferences): NavTheme => {
  if (isNavTheme(record.navTheme)) return record.navTheme
  if (record.colorScheme === "dark") return "realDark"
  return defaultUiPreferences.navTheme
}

export const toProSettings = (preferences: UiPreferences): ProSettings => ({
  colorPrimary: preferences.colorPrimary,
  colorWeak: preferences.colorWeak,
  contentWidth: preferences.contentWidth,
  fixSiderbar: preferences.fixSiderbar,
  fixedHeader: preferences.fixedHeader,
  layout: preferences.layout,
  navTheme: preferences.navTheme,
  siderMenuType: preferences.siderMenuType,
  splitMenus: preferences.splitMenus,
  title: APP_NAME,
})

const fromProSettings = (settings: ProSettings, current: UiPreferences): UiPreferences => ({
  colorPrimary:
    typeof settings.colorPrimary === "string" ? settings.colorPrimary : current.colorPrimary,
  colorWeak: typeof settings.colorWeak === "boolean" ? settings.colorWeak : current.colorWeak,
  contentWidth: isContentWidth(settings.contentWidth)
    ? normalizeContentWidth(settings.contentWidth)
    : current.contentWidth,
  fixSiderbar:
    typeof settings.fixSiderbar === "boolean" ? settings.fixSiderbar : current.fixSiderbar,
  fixedHeader:
    typeof settings.fixedHeader === "boolean" ? settings.fixedHeader : current.fixedHeader,
  layout: isLayoutMode(settings.layout) ? settings.layout : current.layout,
  navTheme: isNavTheme(settings.navTheme) ? settings.navTheme : current.navTheme,
  siderCollapsed: current.siderCollapsed,
  siderMenuType: isSiderMenuType(settings.siderMenuType)
    ? settings.siderMenuType
    : current.siderMenuType,
  splitMenus: typeof settings.splitMenus === "boolean" ? settings.splitMenus : current.splitMenus,
})

const readPreferences = (): UiPreferences => {
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (raw === null) return defaultUiPreferences
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return defaultUiPreferences
    const record: StoredUiPreferences = parsed
    const colorPrimary = record.colorPrimary
    const colorWeak = record.colorWeak
    const fixSiderbar = record.fixSiderbar
    const fixedHeader = record.fixedHeader
    const layout = record.layout
    const siderCollapsed = record.siderCollapsed
    const siderMenuType = record.siderMenuType
    const splitMenus = record.splitMenus
    return {
      colorPrimary:
        typeof colorPrimary === "string" ? colorPrimary : defaultUiPreferences.colorPrimary,
      colorWeak: typeof colorWeak === "boolean" ? colorWeak : defaultUiPreferences.colorWeak,
      contentWidth: normalizeContentWidth(record.contentWidth),
      fixSiderbar:
        typeof fixSiderbar === "boolean" ? fixSiderbar : defaultUiPreferences.fixSiderbar,
      fixedHeader:
        typeof fixedHeader === "boolean" ? fixedHeader : defaultUiPreferences.fixedHeader,
      layout: isLayoutMode(layout) ? layout : defaultUiPreferences.layout,
      navTheme: normalizeNavTheme(record),
      siderCollapsed:
        typeof siderCollapsed === "boolean" ? siderCollapsed : defaultUiPreferences.siderCollapsed,
      siderMenuType: isSiderMenuType(siderMenuType)
        ? siderMenuType
        : defaultUiPreferences.siderMenuType,
      splitMenus: typeof splitMenus === "boolean" ? splitMenus : defaultUiPreferences.splitMenus,
    }
  } catch {
    return defaultUiPreferences
  }
}

const UiPreferencesContext = createContext<UiPreferencesContextValue | null>(null)

type UiPreferencesProviderProps = { readonly children: ReactNode }

export const UiPreferencesProvider = ({ children }: UiPreferencesProviderProps): ReactNode => {
  const [preferences, setPreferencesState] = useState<UiPreferences>(readPreferences)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(preferences))
    document.documentElement.setAttribute(
      "data-theme",
      preferences.navTheme === "realDark" ? "dark" : "light",
    )
    document.body.style.filter = preferences.colorWeak ? "invert(80%)" : "none"
  }, [preferences])

  const setPreferences = useCallback((patch: Partial<UiPreferences>): void => {
    setPreferencesState((current) => ({ ...current, ...patch }))
  }, [])

  const applyLayoutSettings = useCallback((settings: ProSettings): void => {
    setPreferencesState((current) => fromProSettings(settings, current))
  }, [])

  const openSettings = useCallback((): void => {
    setSettingsOpen(true)
  }, [])

  const layoutSettings = useMemo(() => toProSettings(preferences), [preferences])

  const value = useMemo(
    (): UiPreferencesContextValue => ({
      applyLayoutSettings,
      layoutSettings,
      openSettings,
      preferences,
      settingsOpen,
      setPreferences,
      setSettingsOpen,
    }),
    [applyLayoutSettings, layoutSettings, openSettings, preferences, setPreferences, settingsOpen],
  )

  return <UiPreferencesContext.Provider value={value}>{children}</UiPreferencesContext.Provider>
}

export const useUiPreferences = (): UiPreferencesContextValue => {
  const context = useContext(UiPreferencesContext)
  if (context === null) throw new MissingUiPreferencesError()
  return context
}
