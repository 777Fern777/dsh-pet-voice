import { readFileSync } from 'node:fs'
const src = readFileSync('client.js', 'utf8')
new Function(src)
console.log('语法 OK', Buffer.byteLength(src), '字节')
for (const k of ['updateSpeechHint', 'dshpet-probe', 'customPayload', 'watchGen']) {
  console.log(k, src.includes(k) ? '✓' : '✗')
}
