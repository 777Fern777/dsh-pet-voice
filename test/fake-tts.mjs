// 临时假 TTS 服务：给 end-to-end 测试用（POST 任意 JSON，回一段 0.2s 静音 WAV）
import http from 'node:http'

const WAV = (() => {
  const rate = 16000, secs = 0.2, n = Math.floor(rate * secs)
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  return buf
})()

const server = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    console.log('收到', req.method, req.url, Buffer.concat(chunks).toString('utf8').slice(0, 200))
    res.writeHead(200, { 'Content-Type': 'audio/wav' })
    res.end(WAV)
  })
})
server.listen(3999, '127.0.0.1', () => console.log('fake tts on 3999'))
