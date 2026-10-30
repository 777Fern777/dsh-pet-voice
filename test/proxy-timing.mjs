// 量一下「经过宿主代理」的每句延迟，确认代理没拖后腿
const PORT = process.argv[2] || '61414'
const chunk = '上海今天十七到二十四度，'
const body = {
  text: chunk,
  endpoint: 'http://127.0.0.1:9880/tts',
  refAudio: 'D:\\GPT-SoVITS-v2pro-20261006\\voices\\fern_long.wav',
  promptText: 'じゃあおいで、いっぱい撫でます。載せていただいてありがとうございました。',
  bodyTemplate: JSON.stringify({
    text: '{{text}}', text_lang: 'auto', ref_audio_path: '{{refAudio}}',
    prompt_text: '{{promptText}}', prompt_lang: 'ja', media_type: 'wav',
    streaming_mode: false, text_split_method: 'cut5', speed_factor: 1
  })
}
for (let i = 0; i < 3; i++) {
  const t0 = Date.now()
  const res = await fetch(`http://127.0.0.1:${PORT}/dsh-pet/tts/custom`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  })
  const buf = Buffer.from(await res.arrayBuffer())
  const sec = Math.max(0, buf.length - 44) / 64000
  console.log(`第${i + 1}次: status=${res.status} ${buf.length}B 音频 ${sec.toFixed(2)}s 耗时 ${Date.now() - t0}ms`)
}
