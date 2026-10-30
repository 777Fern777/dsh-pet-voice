// 量一下 GPT-SoVITS 的真实延迟：整段 vs 流式 vs 分句
const URL_TTS = 'http://127.0.0.1:9880/tts'
const REF = 'D:\\GPT-SoVITS-v2pro-20261006\\voices\\fern_long.wav'
const PROMPT = 'じゃあおいで、いっぱい撫でます。載せていただいてありがとうございました。'

const SHORT = '今天上海十七到二十四度，多云，上午转晴。'
const LONG = [
  '上海今天十七到二十四度，多云，上午转晴到多云，局部有雾。',
  '早晚有点凉，出门带件薄外套就行，中午太阳出来会暖和不少。',
  '如果你要骑车上学，早上雾可能影响视线，注意慢一点。',
  '另外今天湿度不低，头发容易塌，记得别太在意。'
].join('')

function body(text, extra = {}) {
  return JSON.stringify({
    text,
    text_lang: 'auto',
    ref_audio_path: REF,
    prompt_text: PROMPT,
    prompt_lang: 'ja',
    media_type: 'wav',
    streaming_mode: false,
    text_split_method: 'cut5',
    speed_factor: 1.0,
    ...extra
  })
}

async function timed(label, text, extra) {
  const t0 = Date.now()
  const res = await fetch(URL_TTS, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body(text, extra)
  })
  let firstByteAt = 0
  let bytes = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!firstByteAt) firstByteAt = Date.now()
    bytes += value.length
  }
  const done_ = Date.now()
  const ttfb = firstByteAt ? firstByteAt - t0 : -1
  console.log(
    `${label}: status=${res.status} ${bytes}B  首字节 ${ttfb}ms  总计 ${done_ - t0}ms`
  )
  return done_ - t0
}

console.log('--- 暖机 ---')
await timed('暖机', '你好。')

console.log('--- 非流式 ---')
await timed('短句 非流式', SHORT)
await timed('长文 非流式', LONG)

console.log('--- 流式 streaming_mode=3（低质快返） ---')
await timed('短句 流式3', SHORT, { streaming_mode: 3 })
await timed('长文 流式3', LONG, { streaming_mode: 3 })

console.log('--- 流式 streaming_mode=2 ---')
await timed('长文 流式2', LONG, { streaming_mode: 2 })

console.log('--- cut0 不分句（短句） ---')
await timed('短句 cut0', SHORT, { text_split_method: 'cut0' })
