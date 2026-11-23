// Raw calls for contract section 3.2 (Auth). Components use the hooks in hooks.ts instead.
import { api, ApiError } from '../../api/client'
import type { LoginRequest, RegisterRequest, User } from '../../api/types'

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401
}

export const authApi = {
  /** The signed-in user, or `null` when logged out (401 is an answer here, not an error). */
  async me(signal?: AbortSignal): Promise<User | null> {
    try {
      return await api.get<User>('/auth/me', { signal, skipAuthRedirect: true })
    } catch (error) {
      if (isUnauthorized(error)) return null
      throw error
    }
  },

  // 401 means "Invalid email or password" here, so it must not trigger the session-expiry redirect.
  login: (body: LoginRequest) => api.post<User>('/auth/login', body, { skipAuthRedirect: true }),

  register: (body: RegisterRequest) => api.post<User>('/auth/register', body),

  /** Resolves when the session is gone, including when it had already expired (401). */
  async logout(): Promise<void> {
    try {
      await api.post<void>('/auth/logout', undefined, { skipAuthRedirect: true })
    } catch (error) {
      if (!isUnauthorized(error)) throw error
    }
  },
}
