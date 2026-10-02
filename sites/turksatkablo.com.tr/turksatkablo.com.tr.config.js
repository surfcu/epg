const tls = require('tls')
const http = require('http')
const https = require('https')
const crypto = require('crypto')
const axios = require('axios')
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
const timezone = require('dayjs/plugin/timezone')
const customParseFormat = require('dayjs/plugin/customParseFormat')

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(customParseFormat)

const TZ = 'Europe/Istanbul'
const HOST = 'www.turksatkablo.com.tr'
const BASE = `https://${HOST}/userUpload/EPG`

// The server sends its certificate without the intermediate CA. Browsers download the
// missing intermediate from the certificate's "CA Issuers" URL; Node.js doesn't and fails
// with "unable to verify the first certificate". Do the same as a browser: fetch the
// intermediate, accept it only if a system root CA signed it, and add it to this agent.
const httpsAgent = new https.Agent({ keepAlive: true })
let caPromise

function download(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http
    const req = lib.get(url, { timeout: 15000 }, res => {
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
      }
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
    })
    req.on('timeout', () => req.destroy(new Error(`timeout fetching ${url}`)))
    req.on('error', reject)
  })
}

function peerCertificate() {
  return new Promise((resolve, reject) => {
    // only reads the certificate during the handshake; no request is sent on this socket
    const socket = tls.connect({ host: HOST, port: 443, servername: HOST, rejectUnauthorized: false })
    socket.setTimeout(15000, () => socket.destroy(new Error('TLS handshake timeout')))
    socket.once('secureConnect', () => {
      const result = { authorized: socket.authorized, cert: socket.getPeerCertificate() }
      socket.end()
      resolve(result)
    })
    socket.once('error', reject)
  })
}

function signedBySystemRoot(cert) {
  return tls.rootCertificates.some(pem => {
    try {
      const root = new crypto.X509Certificate(pem)
      return cert.checkIssued(root) && cert.verify(root.publicKey)
    } catch {
      return false
    }
  })
}

function ensureCertificateChain() {
  if (!caPromise) {
    caPromise = (async () => {
      const { authorized, cert } = await peerCertificate()
      if (authorized) return // chain is complete again; nothing to do
      const urls = cert?.infoAccess?.['CA Issuers - URI'] || []
      for (const url of urls) {
        const intermediate = new crypto.X509Certificate(await download(url))
        if (!intermediate.ca || !signedBySystemRoot(intermediate)) continue
        httpsAgent.options.ca = [...tls.rootCertificates, intermediate.toString()]
        return
      }
      throw new Error('no usable intermediate certificate found')
    })().catch(err => {
      console.error(`turksatkablo.com.tr: could not complete the certificate chain: ${err.message}`)
    })
  }
  return caPromise
}

// One file per day of the month: 1.json ... 31.json (no leading zero).
// Only yesterday/today/tomorrow are kept current; the rest still hold last month.
function fileUrl(day) {
  return `${BASE}/${day}.json`
}

function parseJson(content) {
  try {
    const text = Buffer.isBuffer(content) ? content.toString() : String(content || '')
    return JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    return null
  }
}

// The file has no date in it, so use Last-Modified to reject a file left over from last month.
// Current files are published about a day ahead.
function isStale(headers, date) {
  const lastModified = headers?.['last-modified']
  if (!lastModified) return false
  const modified = dayjs(lastModified)
  if (!modified.isValid()) return false
  const day = dayjs.utc(date).startOf('d')
  return modified.isBefore(day.subtract(4, 'd')) || modified.isAfter(day.add(2, 'd'))
}

// Description and image are only on the per-programme details page.
const DETAIL_CONCURRENCY = 5

async function fetchDetails({ date, channelId, programId }) {
  const d = dayjs.utc(date)
  const url = `https://${HOST}/yayin-akisi-program-detay.aspx?d=${d.date()}&m=${
    d.month() + 1
  }&y=${d.year()}&kID=${channelId}&eID=${programId}`
  try {
    const { data } = await axios.get(url, { timeout: 15000, responseType: 'text', httpsAgent })
    const cheerio = require('cheerio')
    const $ = cheerio.load(String(data))
    const box = $('.program-detail')
    const src = box.find('img').attr('src') || null
    const description = box.find('p').text().trim() || null
    return {
      // the page links images over http; the CDN also serves https
      image: src ? src.replace(/^http:\/\//, 'https://') : null,
      description
    }
  } catch {
    return {}
  }
}

// run fn over items, at most `limit` at a time
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

module.exports = {
  site: 'turksatkablo.com.tr',
  days: 2,
  async url({ date }) {
    await ensureCertificateChain()
    return fileUrl(dayjs.utc(date).date())
  },
  request: {
    httpsAgent,
    timeout: 60000,
    cache: {
      ttl: 60 * 60 * 1000 // 1 hour; one file serves every channel
    }
  },
  async parser({ content, headers, channel, date }) {
    if (isStale(headers, date)) return []
    const data = parseJson(content)
    if (!data || !Array.isArray(data.k)) return []

    const entry = data.k.find(c => String(c.i) === String(channel.site_id))
    if (!entry || !Array.isArray(entry.p)) return []

    const day = dayjs.utc(date).format('YYYY-MM-DD')
    const items = []
    let prevStart = null

    entry.p.forEach(item => {
      // a="0" / b="-" marks the part of yesterday's last programme after midnight
      if (!item.b || item.b.trim() === '-' || String(item.a) === '0') return
      if (!item.c || !item.d) return

      let start = dayjs.tz(`${day} ${item.c}`, 'YYYY-MM-DD HH:mm', TZ)
      if (prevStart && start.isBefore(prevStart)) start = start.add(1, 'd')
      let stop = dayjs.tz(`${start.format('YYYY-MM-DD')} ${item.d}`, 'YYYY-MM-DD HH:mm', TZ)
      if (!stop.isAfter(start)) stop = stop.add(1, 'd')
      prevStart = start

      items.push({ id: String(item.a), title: item.b.trim(), start, stop })
    })

    return mapLimit(items, DETAIL_CONCURRENCY, async ({ id, title, start, stop }) => {
      const details = await fetchDetails({ date, channelId: entry.i, programId: id })
      return {
        title,
        description: details.description || null,
        image: details.image || null,
        icon: details.image || null, // <icon> for Tvheadend and older XMLTV readers
        start,
        stop
      }
    })
  },
  async channels() {
    const day = dayjs().tz(TZ).date()
    await ensureCertificateChain()
    const { data } = await axios.get(fileUrl(day), { responseType: 'text', httpsAgent })
    const parsed = parseJson(data)
    const list = parsed?.k || []

    const schedules = new Set()
    const channels = []
    list.forEach(c => {
      // 900+ are copies of main channels with identical schedules; keep the first one
      const key = `${c.n}|${JSON.stringify(c.p)}`
      if (schedules.has(key)) return
      schedules.add(key)
      channels.push({ lang: 'tr', site_id: String(c.i), name: c.n })
    })

    return channels
  }
}
