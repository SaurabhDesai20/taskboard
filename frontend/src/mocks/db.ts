// In-memory data behind the MSW handlers. Module-level, so it lasts until a page reload in the
// browser; tests call resetMockDb() (via resetMockState) after each test.
import type { User } from '../api/types'

export interface MockUserRecord extends User {
  /** Plain text: this is a mock. The real backend stores a hash. */
  password: string
}

/** Seeded account, matching the contract's example user (sign in with it in mock mode). */
export const DEMO_USER: Readonly<MockUserRecord> = {
  id: '10000000-0000-4000-8000-000000000001',
  email: 'asha@example.com',
  name: 'Asha Rao',
  password: 'correct-horse-battery',
  created_at: '2026-11-22T09:00:00Z',
}

interface MockDb {
  users: MockUserRecord[]
  /** Stands in for the httpOnly session cookie: the id of the signed-in user, or null. */
  sessionUserId: string | null
}

export const db: MockDb = { users: [], sessionUserId: null }

export function resetMockDb(): void {
  db.users = [{ ...DEMO_USER }]
  db.sessionUserId = null
}

resetMockDb()

export function toUser({ id, email, name, created_at }: MockUserRecord): User {
  return { id, email, name, created_at }
}

export function findUserByEmail(email: string): MockUserRecord | undefined {
  const wanted = email.toLowerCase()
  return db.users.find((user) => user.email === wanted)
}

export function createUser(fields: { email: string; name: string; password: string }): MockUserRecord {
  const user: MockUserRecord = {
    id: crypto.randomUUID(),
    email: fields.email.toLowerCase(),
    name: fields.name,
    password: fields.password,
    created_at: new Date().toISOString(),
  }
  db.users.push(user)
  return user
}

export function sessionUser(): MockUserRecord | null {
  return db.users.find((user) => user.id === db.sessionUserId) ?? null
}

/** Sign a user in, as if the backend had set the cookie. Tests use it to start logged in. */
export function startMockSession(userId: string = DEMO_USER.id): void {
  db.sessionUserId = userId
}

/** Sign out, or simulate an expired cookie. */
export function endMockSession(): void {
  db.sessionUserId = null
}
