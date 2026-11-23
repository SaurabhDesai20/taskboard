// TanStack Query hooks for the session. The `me` query is the single source of truth for
// "who is logged in": a User when signed in, `null` when logged out.
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import { setUnauthorizedHandler } from '../../api/client'
import type { User } from '../../api/types'
import { authApi } from './api'

export const authKeys = {
  all: ['auth'] as const,
  me: ['auth', 'me'] as const,
}

function isAuthQuery(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === authKeys.all[0]
}

/** Drops every cached query except the session itself (server data may belong to another user). */
function removeUserData(queryClient: QueryClient): void {
  queryClient.removeQueries({ predicate: (query) => !isAuthQuery(query.queryKey) })
}

/** Marks the session as ended. Observers re-render, so RequireAuth redirects to /login. */
function endSession(queryClient: QueryClient): void {
  queryClient.setQueryData<User | null>(authKeys.me, null)
}

async function startSession(queryClient: QueryClient, user: User): Promise<void> {
  // An in-flight /auth/me (e.g. a focus refetch that started while logged out) must not
  // overwrite the user we just received.
  await queryClient.cancelQueries({ queryKey: authKeys.me })
  removeUserData(queryClient)
  queryClient.setQueryData<User | null>(authKeys.me, user)
}

export function useMe() {
  return useQuery({
    queryKey: authKeys.me,
    queryFn: ({ signal }) => authApi.me(signal),
  })
}

/** On success the `me` query holds the user, and RequireGuest sends them on to their target. */
export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: authApi.login,
    onSuccess: (user) => startSession(queryClient, user),
  })
}

/** Registering also signs the user in (the backend sets the cookie). */
export function useRegister() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: authApi.register,
    onSuccess: (user) => startSession(queryClient, user),
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: authApi.logout,
    onSuccess: () => {
      endSession(queryClient)
      removeUserData(queryClient)
      // Navigate explicitly (and synchronously, before the query observers are notified) so the
      // user lands on /login without a "return to" target: logging in again starts at home.
      void navigate('/login', { replace: true, flushSync: true })
    },
  })
}

/**
 * Wires api/client.ts's 401 handler to the session: a 401 from any protected request ends the
 * session in the cache, and RequireAuth then redirects to /login (remembering the page) with
 * an in-app navigation. No full page reload, so no reload loop.
 */
export function useSessionExpiryHandler(): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    const previous = setUnauthorizedHandler(() => endSession(queryClient))
    return () => {
      setUnauthorizedHandler(previous)
    }
  }, [queryClient])
}
