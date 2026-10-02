const { parser, url, request } = require('./tivibu.com.tr.config.js')
const fs = require('fs')
const path = require('path')
const axios = require('axios')
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')

dayjs.extend(utc)

jest.mock('axios')

const date = dayjs.utc('2026-10-03', 'YYYY-MM-DD').startOf('d')
const channel = { lang: 'tr', site_id: '2187', name: 'TARİH TV', xmltv_id: 'TarihTV.tr@SD' }
const content = fs.readFileSync(path.join(__dirname, '__data__', 'content.json'))

axios.get.mockImplementation(url => {
  if (url === 'https://www.tivibu.com.tr/canli-tv') {
    return Promise.resolve({
      headers: { 'set-cookie': ['TS01de49a5=abc; Path=/', '.AspNetCore.Antiforgery.x=def; path=/; samesite=strict; httponly'] },
      data: fs.readFileSync(path.join(__dirname, '__data__', 'canli-tv.html'), 'utf8')
    })
  }
  return Promise.reject(new Error(`unexpected GET ${url}`))
})

it('can generate valid url', () => {
  expect(url).toBe('https://www.tivibu.com.tr/Channel/GetMultiPrevueData')
})

it('can generate valid request headers', async () => {
  const headers = await request.headers({ channel, date })
  expect(headers).toMatchObject({
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    Requestverificationtoken: 'CfDJ8test-token',
    Cookie: 'TS01de49a5=abc; .AspNetCore.Antiforgery.x=def'
  })
})

it('can generate valid request data', async () => {
  const data = new URLSearchParams(await request.data({ channel, date }))
  expect(Object.fromEntries(data)).toEqual({
    channelColumnCode: '020000',
    channelDateBegin: '2026.10.03 00:00:00',
    channelDateEnd: '2026.10.03 23:59:59',
    channelSearchValue: 'TARİH TV',
    pageNo: '1',
    'CSRF-TOKEN-TVBUDNBX!-FORM': 'CfDJ8test-token'
  })
})

it('can parse response', async () => {
  const results = (await parser({ content, channel, date })).map(p => {
    p.start = p.start.toJSON()
    p.stop = p.stop.toJSON()
    return p
  })

  expect(results.length).toBe(5)
  expect(results[0]).toMatchObject({
    title: 'Belgelerle Tarih',
    category: 'Yaşam',
    image: 'https://itv224226.tmp.tivibu.com.tr:6430/images/prevueposter/20260929097177.jpg',
    start: '2026-10-02T21:00:00.000Z',
    stop: '2026-10-02T21:35:00.000Z'
  })
  // last programme runs past midnight
  expect(results[4]).toMatchObject({
    title: 'Türk Tarihinin İzinde',
    start: '2026-10-03T20:00:00.000Z',
    stop: '2026-10-03T21:30:00.000Z'
  })
})

it('skips the previous day programme that runs past midnight', async () => {
  const results = await parser({ content, channel: { site_id: 'ch00000000000000001258' }, date })
  expect(results.map(p => p.title)).toEqual(['Gece Gelen', 'Sessizliğin Sesi'])
  expect(results[0].start.toJSON()).toBe('2026-10-02T22:45:00.000Z')
})

it('can handle empty guide', async () => {
  axios.post.mockResolvedValue({ data: { prevueListViewModel: [] } })
  expect(await parser({ content: '', channel, date })).toMatchObject([])
  expect(await parser({ content: '{"prevueListViewModel":[]}', channel, date })).toMatchObject([])
})
