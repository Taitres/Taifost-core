import { XMLParser } from 'fast-xml-parser'

export interface ParsedHotspotItem {
  title: string
  url?: string
  summary?: string
  publishedAt?: Date
  raw: Record<string, unknown>
}

const asArray = <T>(value: T | T[] | null | undefined): T[] =>
  value === null || value === undefined
    ? []
    : Array.isArray(value)
      ? value
      : [value]

const textOf = (value: unknown): string | undefined => {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).trim() || undefined
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return textOf(record['#text'] ?? record.__cdata ?? record.content)
  }
  return undefined
}

const dateOf = (value: unknown): Date | undefined => {
  const text = textOf(value)
  if (!text) return undefined
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? undefined : date
}

const valueAt = (input: unknown, path: string): unknown =>
  path
    .split('.')
    .filter(Boolean)
    .reduce<unknown>((value, key) => {
      if (!value || typeof value !== 'object') return undefined
      return (value as Record<string, unknown>)[key]
    }, input)

const recordOf = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value }

export function parseHotspotPayload(
  format: 'rss' | 'atom' | 'json',
  body: string,
  config: Record<string, unknown> = {},
): ParsedHotspotItem[] {
  if (format === 'json') {
    const parsed = JSON.parse(body) as unknown
    const itemsPath =
      typeof config.itemsPath === 'string' ? config.itemsPath : ''
    const items = asArray(itemsPath ? valueAt(parsed, itemsPath) : parsed)
    const titlePath =
      typeof config.titlePath === 'string' ? config.titlePath : 'title'
    const urlPath =
      typeof config.urlPath === 'string' ? config.urlPath : 'url'
    const summaryPath =
      typeof config.summaryPath === 'string'
        ? config.summaryPath
        : 'summary'
    const publishedAtPath =
      typeof config.publishedAtPath === 'string'
        ? config.publishedAtPath
        : 'publishedAt'
    return items
      .map((item) => ({
        title: textOf(valueAt(item, titlePath)) ?? '',
        url: textOf(valueAt(item, urlPath)),
        summary: textOf(valueAt(item, summaryPath)),
        publishedAt: dateOf(valueAt(item, publishedAtPath)),
        raw: recordOf(item),
      }))
      .filter((item) => item.title)
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    trimValues: true,
  })
  const parsed = parser.parse(body) as Record<string, unknown>
  const rawItems =
    format === 'rss'
      ? asArray(valueAt(parsed, 'rss.channel.item'))
      : asArray(valueAt(parsed, 'feed.entry'))

  return rawItems
    .map((item) => {
      const raw = recordOf(item)
      const linkValue = raw.link
      const atomLink = asArray(linkValue).find(
        (link) =>
          !link ||
          typeof link !== 'object' ||
          !(link as Record<string, unknown>)['@rel'] ||
          (link as Record<string, unknown>)['@rel'] === 'alternate',
      )
      const url =
        textOf(raw.guid) ??
        (atomLink && typeof atomLink === 'object'
          ? textOf((atomLink as Record<string, unknown>)['@href'])
          : textOf(atomLink))
      return {
        title: textOf(raw.title) ?? '',
        url,
        summary:
          textOf(raw.description) ??
          textOf(raw.summary) ??
          textOf(raw.content),
        publishedAt:
          dateOf(raw.pubDate) ?? dateOf(raw.published) ?? dateOf(raw.updated),
        raw,
      }
    })
    .filter((item) => item.title)
}
