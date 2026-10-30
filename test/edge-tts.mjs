// Edge TTS 免密钥通道（带 Sec-MS-GEC 鉴权）测试
import crypto from 'node:crypto'
import fs from 'node:fs'

const TRUSTED = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const WIN_VER = '1-' + ((1 << 48) | (13 << 32) | (0 << 16) | 0)

function secMsGec() {
  let ticks = Math.floor(Date.now() / 1000) + 11644473600
  ticks -= ticks % 300
  const s = String(ticks * 10000000) + TRUSTED
  return crypto.createHash('sha256').update(s, 'ascii').digest('hex').toUpperCase()
}

const text = process.argv[2] || '你好呀，我是大肥鱼。'
const voice = process.argv[3] || 'zh-CN-XiaoxiaoNeural'
const outFile = process.argv[4] || 'edge-tts-test.mp3'

const url = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'
  + '?TrustedClientToken=' + TRUSTED
  + '&Sec-MS-GEC=' + secMsGec()
  + '&Sec-MS-GEC-Version=' + WIN_VER
  + '&ConnectionId=' + crypto.randomUUID().replace(/-/g, '')

const ssml = '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">'
  + '<voice name="' + voice + '"><prosody rate="+0%" pitch="+0Hz">'
  + text.replace(/[<>&]/g, '') + '</prosody></voice></speak>'

const started = Date.now()
const chunks = []
// Node 全局 WebSocket（undici）不接受 headers 选项，鉴权只能靠 URL 上的 Sec-MS-GEC
const ws = new WebSocket(url)
ws.binaryType = 'arraybuffer'

const timer = setTimeout(() => { console.log('❌ 超时'); try { ws.close() } catch (e) {}; process.exit(2) }, 25000)

ws.addEventListener('open', () => {
  console.log('· 已连接，发送配置与 SSML')
  ws.send('X-Timestamp:' + new Date().toUTCString() + '\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n'
    + JSON.stringify({ context: { synthesis: { audio: {
      metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' },
      outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
    } } } }))
  ws.send('X-RequestId:' + crypto.randomUUID().replace(/-/g, '')
    + '\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:' + new Date().toUTCString()
    + '\r\nPath:ssml\r\n\r\n' + ssml)
})

ws.addEventListener('message', (ev) => {
  const d = ev.data
  if (typeof d === 'string') {
    if (d.includes('Path:turn.end')) {
      clearTimeout(timer)
      const buf = Buffer.concat(chunks)
      console.log('✅ 音频 %d 字节，耗时 %d ms', buf.length, Date.now() - started)
      if (buf.length > 2000) { fs.writeFileSync(outFile, buf); console.log('已写入 ' + outFile) }
      try { ws.close() } catch (e) {}
      process.exit(0)
    }
  } else {
    const b = Buffer.from(d)
    chunks.push(b.subarray(2 + b.readUInt16BE(0)))
  }
})

ws.addEventListener('error', (e) => {
  clearTimeout(timer)
  const err = (e && e.error) || e
  console.log('❌ 错误：', (err && (err.message || err.code)) || String(err))
  console.log('   cause:', err && err.cause && (err.cause.message || err.cause.code))
  process.exit(3)
})

ws.addEventListener('close', (ev) => {
  if (chunks.length === 0) console.log('关闭 code=' + ev.code + ' reason=' + ev.reason)
})
