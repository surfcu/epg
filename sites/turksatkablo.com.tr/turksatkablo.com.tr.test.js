const { parser, url, channels } = require('./turksatkablo.com.tr.config.js')
const fs = require('fs')
const path = require('path')
const axios = require('axios')
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')

dayjs.extend(utc)

jest.mock('axios')

const date = dayjs.utc('2026-10-03', 'YYYY-MM-DD').startOf('d')
const channel = { site_id: '22', xmltv_id: 'TRT1.tr@SD' }
const content = fs.readFileSync(path.resolve(__dirname, '__data__/content.json'))
const headers = { 'last-modified': 'Fri, 02 Oct 2026 12:47:18 GMT' }

it('can generate valid url', () => {
  expect(url({ date })).toBe('https://www.turksatkablo.com.tr/userUpload/EPG/3.json')
  expect(url({ date: dayjs.utc('2026-10-28') })).toBe(
    'https://www.turksatkablo.com.tr/userUpload/EPG/28.json'
  )
})

it('can parse response', () => {
  const results = parser({ content, headers, channel, date }).map(p => {
    p.start = p.start.toJSON()
    p.stop = p.stop.toJSON()
    return p
  })

  // the "-" placeholder (yesterday's programme after midnight) is skipped
  expect(results.length).toBe(5)
  expect(results[0]).toMatchObject({
    title: 'Alparslan: Büyük Selçuklu',
    start: '2026-10-02T23:55:00.000Z',
    stop: '2026-10-03T02:28:00.000Z'
  })
  // last programme runs past midnight
  expect(results[4]).toMatchObject({
    title: 'Gönül Dağı',
    start: '2026-10-03T17:00:00.000Z',
    stop: '2026-10-03T21:15:00.000Z'
  })
})

it('handles a programme that starts at 23:45 and ends after midnight', () => {
  const results = parser({ content, headers, channel: { site_id: '2' }, date })
  expect(results.map(p => p.title)).toEqual(['Gece Gelen', 'Sessizliğin Sesi', 'Aşk İşaretleri'])
  expect(results[2].start.toJSON()).toBe('2026-10-03T20:45:00.000Z')
  expect(results[2].stop.toJSON()).toBe('2026-10-03T22:45:00.000Z')
})

it('ignores a file left over from last month', () => {
  const stale = { 'last-modified': 'Thu, 03 Sep 2026 12:47:18 GMT' }
  expect(parser({ content, headers: stale, channel, date })).toMatchObject([])
})

it('can handle empty guide', () => {
  expect(parser({ content: '', headers, channel, date })).toMatchObject([])
  expect(parser({ content: '<!DOCTYPE html><html></html>', headers, channel, date })).toMatchObject([])
  expect(parser({ content, headers, channel: { site_id: '9999' }, date })).toMatchObject([])
})

it('can parse channel list', async () => {
  axios.get.mockResolvedValue({ data: content.toString() })
  const results = await channels()
  // 900 is an exact copy of 22 and is dropped
  expect(results).toEqual([
    { lang: 'tr', site_id: '2', name: 'Sinema TV' },
    { lang: 'tr', site_id: '22', name: 'TRT 1' }
  ])
})
