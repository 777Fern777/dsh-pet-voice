// 复现「第一句正常、后面句子 400」：把真实回答切句后，按顺序 / 并发各打一遍
const PORT = process.argv[2] || '63265'
const BASE = `http://127.0.0.1:${PORT}`
const REF = 'D:\\GPT-SoVITS-v2pro-20261006\\voices\\fern_long.wav'
const PROMPT = 'じゃあおいで、いっぱい撫でます。載せていただいてありがとうございました。'

const text = process.argv[3] || '第一句先这样说话试试看效果。第二句稍微长一点点，看看会不会出错。第三句更长了，包含逗号、顿号、以及省略号……还有问号吗？第四句收尾。'

function chunks(s) {
  return String(s).split(/(?<=[。！？!?…])\s*/).map((x) => x.trim()).filter(Boolean)
}

function body(chunk) {
  return JSON.stringify({
    text: chunk,
    endpoint: 'http://127.0.0.1:9880/tts',
    apiKey: '',
    model: '',
    voice: '',
    refAudio: REF,
    promptText: PROMPT,
    bodyTemplate: JSON.stringify({
      text: '{{text}}',
      text_lang: 'auto',
      ref_audio_path: '{{refAudio}}',
      prompt_text: '{{promptText}}',
      prompt_lang: 'ja',
      media_type: 'wav',
      streaming_mode: false,
      text_split_method: 'cut5',
      speed_factor: 1,
    }),
  })
}

async function one(chunk, tag) {
  const t0 = Date.now()
  const resp = await fetch(BASE + '/dsh-pet/tts/custom', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body(chunk),
  })
  const ab = await resp.arrayBuffer()
  const head = Buffer.from(ab).slice(0, 4).toString('latin1')
  const tail = resp.ok ? '' : Buffer.from(ab).toString('utf8').slice(0, 220)
  console.log(`${tag} status=${resp.status} bytes=${ab.byteLength} head=${head} ms=${Date.now() - t0} ${tail}`)
  return { status: resp.status, text: tail }
}

const list = chunks(text)
console.log('切句：', list.map((c, i) => `[${i}] ${c}`).join(' | '))

console.log('\n--- 顺序 ---')
for (let i = 0; i < list.length; i++) await one(list[i], 'seq' + i)

console.log('\n--- 并发 2 ---')
const pairs = []
for (let i = 0; i < list.length; i += 2) {
  pairs.push(await Promise.all([one(list[i], 'par' + i), list[i + 1] ? one(list[i + 1], 'par' + (i + 1)) : null].filter(Boolean)))
}
