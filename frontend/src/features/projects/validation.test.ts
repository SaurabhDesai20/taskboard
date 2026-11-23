import { describe, expect, it } from 'vitest'
import type { Project } from '../../api/types'
import {
  normalizeProjectCreate,
  projectChanges,
  validateProjectCreate,
  validateProjectEdit,
} from './validation'

const project: Project = {
  id: '30000000-0000-4000-8000-000000000001',
  workspace_id: '20000000-0000-4000-8000-000000000001',
  name: 'Website',
  key: 'WEB',
  description: 'Marketing site',
  archived_at: null,
  created_by: '10000000-0000-4000-8000-000000000001',
  created_at: '2026-11-22T09:15:00Z',
}

describe('validateProjectCreate', () => {
  it('accepts a valid project, trimming text first', () => {
    expect(validateProjectCreate({ name: '  Website ', key: ' WEB ', description: '' })).toEqual({})
  })

  it('reports every invalid field', () => {
    expect(validateProjectCreate({ name: '   ', key: '', description: 'x'.repeat(2001) })).toEqual({
      name: 'Enter a project name',
      key: 'Enter a project key',
      description: 'Description must be at most 2000 characters',
    })
  })

  it.each([
    ['W', 'Key must be 2 to 10 characters'],
    ['ABCDEFGHIJK', 'Key must be 2 to 10 characters'],
    ['web', 'Use uppercase letters and digits, starting with a letter, like "WEB"'],
    ['1WEB', 'Use uppercase letters and digits, starting with a letter, like "WEB"'],
    ['WE-B', 'Use uppercase letters and digits, starting with a letter, like "WEB"'],
  ])('rejects the key %j', (key, message) => {
    expect(validateProjectCreate({ name: 'Website', key, description: '' }).key).toBe(message)
  })

  it('limits the name to 100 characters', () => {
    expect(validateProjectCreate({ name: 'x'.repeat(101), key: 'WEB', description: '' }).name).toBe(
      'Name must be at most 100 characters',
    )
    expect(validateProjectCreate({ name: 'x'.repeat(100), key: 'WEB', description: '' })).toEqual({})
  })
})

describe('validateProjectEdit', () => {
  it('checks the name and description only', () => {
    expect(validateProjectEdit({ name: '', description: '' })).toEqual({ name: 'Enter a project name' })
    expect(validateProjectEdit({ name: 'Ok', description: 'x'.repeat(2000) })).toEqual({})
  })
})

describe('normalizeProjectCreate', () => {
  it('trims and leaves out an empty description', () => {
    expect(normalizeProjectCreate({ name: ' Website ', key: ' WEB ', description: '  ' })).toEqual({
      name: 'Website',
      key: 'WEB',
    })
    expect(normalizeProjectCreate({ name: 'Website', key: 'WEB', description: ' Site ' })).toEqual({
      name: 'Website',
      key: 'WEB',
      description: 'Site',
    })
  })
})

describe('projectChanges', () => {
  it('is empty when nothing changed', () => {
    expect(projectChanges(project, { name: ' Website ', description: 'Marketing site' })).toEqual({})
  })

  it('sends only changed fields, and null to clear the description', () => {
    expect(projectChanges(project, { name: 'Website v2', description: 'Marketing site' })).toEqual({
      name: 'Website v2',
    })
    expect(projectChanges(project, { name: 'Website', description: '   ' })).toEqual({ description: null })
    expect(projectChanges({ ...project, description: null }, { name: 'Website', description: '' })).toEqual({})
  })
})
