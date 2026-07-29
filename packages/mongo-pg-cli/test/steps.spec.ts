import { parseEntityId } from '@mx-space/db-schema/id'
import { describe, expect, it } from 'vitest'

import { createResolver, remapId } from '../src/id-map'
import {
  normalizeLegacyJsonbObject,
  resolveTranslationEntryLookupKey,
  upsertRows,
} from '../src/steps'
import type { MigrationContext } from '../src/types'

const buildContext = (): MigrationContext =>
  ({
    idMap: new Map(),
    reports: {
      duplicateKeys: [],
      missingRefs: [],
      rowsLoaded: {},
      rowsRead: {},
      startedAt: new Date(),
      warnings: [],
    },
  }) as MigrationContext

describe('normalizeLegacyJsonbObject', () => {
  it('parses legacy JSON string metadata into an object', () => {
    const ctx = buildContext()

    expect(
      normalizeLegacyJsonbObject(
        ctx,
        'posts',
        'mongo-post-id',
        'meta',
        '{"lang":"en","cover":{"src":"cover.png"}}',
      ),
    ).toEqual({
      cover: { src: 'cover.png' },
      lang: 'en',
    })
    expect(ctx.reports.warnings).toHaveLength(0)
  })

  it('preserves object metadata and normalizes invalid jsonb object values', () => {
    const ctx = buildContext()
    const meta = { lang: 'zh-CN' }

    expect(
      normalizeLegacyJsonbObject(ctx, 'notes', 'mongo-note-id', 'meta', meta),
    ).toBe(meta)
    expect(
      normalizeLegacyJsonbObject(ctx, 'pages', 'mongo-page-id', 'meta', '['),
    ).toBeNull()
    expect(
      normalizeLegacyJsonbObject(ctx, 'drafts', 'mongo-draft-id', 'meta', [
        'not-object',
      ]),
    ).toBeNull()
    expect(ctx.reports.warnings).toEqual([
      {
        collection: 'pages',
        mongoId: 'mongo-page-id',
        reason: 'meta contains invalid JSON string',
      },
      {
        collection: 'drafts',
        mongoId: 'mongo-draft-id',
        reason: 'meta must be a JSON object; received array',
      },
    ])
  })
})

describe('upsertRows', () => {
  it('falls back to individual rows when a batch insert fails', async () => {
    const ctx = buildContext()
    const inserted: string[] = []
    const table = {
      [Symbol.for('drizzle:Name')]: 'posts',
    }

    ctx.mode = 'apply'
    ctx.pg = {
      insert: () => ({
        values: (rows: Array<{ id: string }>) => ({
          onConflictDoNothing: async () => {
            if (rows.length > 1) throw new Error('batch failed')
            if (rows[0].id === 'bad') {
              throw new Error('query failed', {
                cause: new Error('invalid row'),
              })
            }
            inserted.push(rows[0].id)
          },
        }),
      }),
    } as MigrationContext['pg']

    await upsertRows(ctx, table, [{ id: 'good' }, { id: 'bad' }])

    expect(inserted).toEqual(['good'])
    expect(ctx.reports.warnings).toEqual([
      {
        collection: 'posts',
        mongoId: 'bad',
        reason: 'query failed: invalid row',
      },
    ])
  })
})

describe('remapId', () => {
  it('updates the in-memory resolver for natural-key conflicts', async () => {
    const ctx = buildContext()
    ctx.mode = 'dry-run'
    ctx.idMap.set(
      'categories',
      new Map([['mongo-default', parseEntityId('1001')]]),
    )

    await remapId(
      ctx,
      'categories',
      'mongo-default',
      parseEntityId('2002'),
    )

    expect(
      createResolver(ctx, 'posts').ref(
        'categories',
        'mongo-default',
        'categoryId',
        true,
      ),
    ).toBe('2002')
  })
})

describe('resolveTranslationEntryLookupKey', () => {
  it('rewrites entity lookup keys to Snowflake IDs while preserving dict hashes', () => {
    const ctx = buildContext()
    ctx.idMap.set(
      'translation_entries',
      new Map([['665000000000000000000001', parseEntityId('1001')]]),
    )
    ctx.idMap.set(
      'categories',
      new Map([['665000000000000000000002', parseEntityId('2002')]]),
    )
    ctx.idMap.set(
      'topics',
      new Map([['665000000000000000000003', parseEntityId('3003')]]),
    )
    const entryResolver = createResolver(ctx, 'translation_entries')

    expect(
      resolveTranslationEntryLookupKey(ctx, entryResolver, {
        keyPath: 'category.name',
        keyType: 'entity',
        lookupKey: '665000000000000000000002',
      }),
    ).toBe('2002')
    expect(
      resolveTranslationEntryLookupKey(ctx, entryResolver, {
        keyPath: 'topic.introduce',
        keyType: 'entity',
        lookupKey: '665000000000000000000003',
      }),
    ).toBe('3003')
    expect(
      resolveTranslationEntryLookupKey(ctx, entryResolver, {
        keyPath: 'note.mood',
        keyType: 'dict',
        lookupKey: 'already-hashed',
      }),
    ).toBe('already-hashed')
    expect(ctx.reports.missingRefs).toHaveLength(0)
  })

  it('reports missing entity lookup references', () => {
    const ctx = buildContext()
    const entryResolver = createResolver(ctx, 'translation_entries')

    expect(
      resolveTranslationEntryLookupKey(ctx, entryResolver, {
        keyPath: 'topic.name',
        keyType: 'entity',
        lookupKey: '665000000000000000000004',
      }),
    ).toBeNull()
    expect(ctx.reports.missingRefs).toEqual([
      {
        collection: 'translation_entries',
        field: 'lookupKey',
        mongoId: '665000000000000000000004',
      },
    ])
  })
})
