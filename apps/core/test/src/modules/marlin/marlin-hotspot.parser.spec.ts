import { describe, expect, it } from 'vitest'

import { parseHotspotPayload } from '~/modules/marlin/hotspot/marlin-hotspot.parser'

describe('parseHotspotPayload', () => {
  it('parses RSS items with evidence fields', () => {
    const items = parseHotspotPayload(
      'rss',
      `<?xml version="1.0"?>
      <rss><channel><item>
        <title>Core v3 发布</title>
        <link>https://example.com/post?utm_source=test</link>
        <description>版本更新</description>
        <pubDate>Tue, 28 Jul 2026 08:00:00 GMT</pubDate>
      </item></channel></rss>`,
    )

    expect(items).toHaveLength(1)
    expect(items[0]).toEqual(
      expect.objectContaining({
        title: 'Core v3 发布',
        url: 'https://example.com/post?utm_source=test',
        summary: '版本更新',
      }),
    )
    expect(items[0].publishedAt).toBeInstanceOf(Date)
  })

  it('parses Atom alternate links', () => {
    const items = parseHotspotPayload(
      'atom',
      `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
        <title>Shiro 更新</title>
        <link rel="alternate" href="https://example.com/shiro" />
        <summary>前端更新</summary>
      </entry></feed>`,
    )

    expect(items[0]).toEqual(
      expect.objectContaining({
        title: 'Shiro 更新',
        url: 'https://example.com/shiro',
      }),
    )
  })

  it('supports configurable JSON list paths and field mappings', () => {
    const items = parseHotspotPayload(
      'json',
      JSON.stringify({
        result: {
          list: [{ headline: '今日热点', href: 'https://example.com/hot' }],
        },
      }),
      {
        itemsPath: 'result.list',
        titlePath: 'headline',
        urlPath: 'href',
      },
    )

    expect(items).toEqual([
      expect.objectContaining({
        title: '今日热点',
        url: 'https://example.com/hot',
      }),
    ])
  })
})
