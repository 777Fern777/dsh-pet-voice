// 1) 验切句逻辑（直接从 client.js 里抠出 splitForSpeech 跑）2) 用真实 GPT-SoVITS 模拟流水线播放时序
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const m = src.match(/function splitForSpeech\(text\) \{[\s\S]*?\n  \}/)
if (!m) throw new Error('没找到 splitForSpeech')
const splitForSpeech = new Function(m[0] + '; return splitForSpeech')()

const samples = [
  '哼，本鱼又不知道你在哪座城市，没法凭空猜天气。告诉我你在哪个城市，我去查实时天气。',
  '上海今天十七到二十四度，多云，上午转晴到多云，局部有雾。早晚有点凉，出门带件薄外套就行，中午太阳出来会暖和不少。如果你要骑车上学，早上雾可能影响视线，注意慢一点。',
  '好。',
  '这题的关键在于把整段合成改成一句一合成，这样第一句合成完就能播，不用等后面九句都算完。第二句说点别的。第三句也是废话。'
]
for (const s of samples) {
  const chunks = splitForSpeech(s)
  console.log(`\n原文 ${s.length} 字 → ${chunks.length} 段`)
  chunks.forEach((c, i) => console.log(`  [${i}] ${c.length}字  ${c}`))
  const joined = chunks.join('')
  if (joined !== s.replace(/\s+/g, '')) console.log('  ⚠ 切句有字丢失或多余:', JSON.stringify(joined))
  if (chunks[0].length > 30) console.log('  ⚠ 首句偏长，首字延迟会高')
}

// ---- 时序模拟：1 深预取 + 顺序播放 ----
const URL_TTS = 'http://127.0.0.1:9880/tts'
const REF = 'D:\\GPT-SoVITS-v2pro-20261006\\voices\\fern_long.wav'
const PROMPT = 'じゃあおいで、いっぱい撫でます。載せていただいてありがとうございました。'
const text = samples[1]

function payload(t) {
  return JSON.stringify({
    text: t, text_lang: 'auto', ref_audio_path: REF, prompt_text: PROMPT, prompt_lang: 'ja',
    media_type: 'wav', streaming_mode: false, text_split_method: 'cut5', speed_factor: 1
  })
}
async function synth(chunk) {
  const t0 = Date.now()
  const res = await fetch(URL_TTS, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload(chunk) })
  const buf = Buffer.from(await res.arrayBuffer())
  const seconds = Math.max(0, (buf.length - 44)) / (32000 * 2) // 32k s16 mono
  return { ms: Date.now() - t0, seconds, bytes: buf.length }
}

console.log('\n--- 暖机 ---')
await synth('你好。')

const chunks = splitForSpeech(text)
const t0 = Date.now()
let ahead = synth(chunks[0])
let readyAt = []
let playEnd = 0
let firstAudioAt = 0
for (let i = 0; i < chunks.length; i++) {
  const cur = await ahead
  const arrivedAt = Date.now() - t0
  readyAt.push(arrivedAt)
  ahead = i + 1 < chunks.length ? synth(chunks[i + 1]) : null
  const startAt = Math.max(arrivedAt, playEnd)
  const gap = startAt - playEnd
  if (i === 0) firstAudioAt = startAt
  else if (gap > 150) console.log(`  ⚠ 第 ${i} 句前有空档 ${gap}ms`)
  playEnd = startAt + cur.seconds * 1000
  console.log(`  [${i}] 合成 ${cur.ms}ms 音频 ${cur.seconds.toFixed(2)}s 到达 ${arrivedAt}ms 开播 ${startAt}ms`)
}
console.log(`\n首句出声：${firstAudioAt}ms（旧做法要等整段：见下）`)
const whole = await synth(text)
console.log(`整段一次合成：${whole.ms}ms，音频 ${whole.seconds.toFixed(2)}s`)
