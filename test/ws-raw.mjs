// 手写 WebSocket 客户端（tls + 掩码帧）：Node 自带 WebSocket 不让设 Origin/UA 头，
// 而 Edge 朗读端点要这些头才肯握手。顺便验证 Edge TTS 免密钥通道是否可用。
import tls from 'node:tls'
import crypto from 'node:crypto'
import fs from 'node:fs'

const TRUSTED = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'

function secMsGec() {
  let ticks = Math.floor(Date.now() / 1000) + 11644473600
  ticks -= ticks % 300
  return crypto.createHash('sha256').update(String(ticks * 10000000) + TRUSTED, 'ascii').digest('hex').toUpperCase()
}

function makeFrame(opcode, payload) {
  const p = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8')
  const mask = crypto.randomBytes(4)
  let header
  if (p.length < 126) header = Buffer.from([0x80 | opcode, 0x80 | p.length])
  else if (p.length < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x80 | opcode; header[1] = 0x80 | 126; header.writeUInt16BE(p.length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x80 | opcode; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(p.length), 2)
  }
  const masked = Buffer.alloc(p.length)
  for (let i = 0; i < p.length; i++) masked[i] = p[i] ^ mask[i & 3]
  return Buffer.concat([header, mask, masked])
}

function wsConnect(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64')
    const sock = tls.connect({ host: url.hostname, port: 443, servername: url.hostname })
    sock.setNoDelay(true)
    const headers = {
      Host: url.hostname,
      Upgrade: 'websocket',
      Connection: 'Upgrade',
      'Sec-WebSocket-Key': key,
      'Sec-WebSocket-Version': '13',
      ...extraHeaders,
    }
    let pending = Buffer.alloc(0)
    let upgraded = false
    let onMessage = () => {}

    sock.once('error', reject)
    sock.once('connect', () => {
      sock.write('GET ' + url.pathname + url.search + ' HTTP/1.1\r\n'
        + Object.entries(headers).map(([k, v]) => k + ': ' + v).join('\r\n') + '\r\n\r\n')
    })

    sock.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk])
      if (!upgraded) {
        const idx = pending.indexOf('\r\n\r\n')
        if (idx < 0) return
        const head = pending.subarray(0, idx).toString('latin1')
        pending = pending.subarray(idx + 4)
        const status = head.split('\r\n')[0]
        if (!/ 101 /.test(status)) {
          sock.destroy()
          reject(new Error('握手被拒：' + status))
          return
        }
        upgraded = true
        resolve({
          send: (opcode, payload) => sock.write(makeFrame(opcode, payload)),
          onMessage: (cb) => { onMessage = cb },
          close: () => { try { sock.end() } catch (e) {} },
        })
      }
      // 解析帧
      let fragBuf = null
      for (;;) {
        if (pending.length < 2) return
        const b0 = pending[0]
        const b1 = pending[1]
        const fin = (b0 & 0x80) !== 0
        const opcode = b0 & 0x0f
        const masked = (b1 & 0x80) !== 0
        let len = b1 & 0x7f
        let off = 2
        if (len === 126) { if (pending.length < 4) return; len = pending.readUInt16BE(2); off = 4 }
        else if (len === 127) { if (pending.length < 10) return; len = Number(pending.readBigUInt64BE(2)); off = 10 }
        if (masked) off += 4
        if (pending.length < off + len) return
        const payload = pending.subarray(off, off + len)
        pending = pending.subarray(off + len)
        if (opcode === 0x9) { sock.write(makeFrame(0xA, payload)); continue }
        if (opcode === 0x8) { sock.end(); return }
        if (opcode === 0x1 || opcode === 0x2) {
          const data = fragBuf ? Buffer.concat([fragBuf, payload]) : Buffer.from(payload)
          fragBuf = null
          onMessage(data, opcode)
          continue
        }
      }
    })
  })
}

const text = process.argv[2] || '你好呀，我是大肥鱼。'
const voice = process.argv[3] || 'zh-CN-XiaoxiaoNeural'
const outFile = process.argv[4] || 'edge-test.mp3'

const url = new URL('wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'
  + '?TrustedClientToken=' + TRUSTED
  + '&Sec-MS-GEC=' + secMsGec()
  + '&Sec-MS-GEC-Version=1-130.0.2849.68'
  + '&ConnectionId=' + crypto.randomUUID().replace(/-/g, ''))

const started = Date.now()
try {
  const ws = await wsConnect(url, {
    Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    Pragma: 'no-cache',
    'Cache-Control': 'no-cache',
    'Accept-Language': 'en-US,en;q=0.9',
  })
  console.log('✅ 握手成功')
  const chunks = []
  ws.onMessage((data, opcode) => {
    if (opcode === 0x1) {
      const s = data.toString('utf8')
      if (s.includes('Path:turn.end')) {
        const buf = Buffer.concat(chunks)
        console.log('✅ 音频 %d 字节，耗时 %d ms', buf.length, Date.now() - started)
        if (buf.length > 2000) fs.writeFileSync(outFile, buf)
        ws.close()
        process.exit(0)
      }
    } else {
      chunks.push(data.subarray(2 + data.readUInt16BE(0)))
    }
  })
  ws.send(0x1, 'X-Timestamp:' + new Date().toUTCString() + '\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n'
    + JSON.stringify({ context: { synthesis: { audio: {
      metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' },
      outputFormat: 'audio-24khz-48kbitrate-mono-mp3' } } } }))
  ws.send(0x1, 'X-RequestId:' + crypto.randomUUID().replace(/-/g, '')
    + '\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:' + new Date().toUTCString()
    + '\r\nPath:ssml\r\n\r\n<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN"><voice name="'
    + voice + '">' + text + '</voice></speak>')
  setTimeout(() => { console.log('❌ 超时没等到 turn.end'); process.exit(2) }, 25000)
} catch (err) {
  console.log('❌ ' + err.message)
  process.exit(3)
}
