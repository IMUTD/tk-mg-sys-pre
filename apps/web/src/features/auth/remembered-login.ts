const storageKey = "tk-mg.remembered-login"

export type RememberedLogin = {
  readonly email: string
}

type StoredRememberedLogin = {
  readonly email?: unknown
  readonly password?: unknown
}

export const readRememberedLogin = (): RememberedLogin | null => {
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return null
    const record: StoredRememberedLogin = parsed
    const email = record.email
    if (typeof email !== "string" || email.length === 0) return null
    if (typeof record.password === "string" && record.password.length > 0) {
      writeRememberedLogin({ email })
    }
    return { email }
  } catch {
    return null
  }
}

export const writeRememberedLogin = (login: RememberedLogin): void => {
  window.localStorage.setItem(storageKey, JSON.stringify({ email: login.email }))
}

export const clearRememberedLogin = (): void => {
  window.localStorage.removeItem(storageKey)
}
