// 离线自检：用一个假的 cordis root/ctx 跑一遍 apply()，验证路由注册、注入行、tapIndex 都正常。
import assert from 'node:assert'
import plugin from '../index.js'

const handlers = []
const taps = []
const eventHandlers = {}

const fakeCtx = {
  webServer: {
    register(route) {
      handlers.push(route)
      return () => {}
    },
    tapIndex(fn) {
      taps.push(fn)
      return () => {}
    },
  },
}

const root = {
  effect(fn) { fn() },              // 立刻执行，返回的 disposer 我们不要
  on(name, cb) { (eventHandlers[name] ||= []).push(cb) },
  inject(_services, cb) { cb(fakeCtx) },
}

assert.equal(typeof plugin.name, 'string', 'plugin.name 必须是字符串')
assert.equal(typeof plugin.apply, 'function', 'plugin.apply 必须是函数（cordis 插件 API）')

plugin.apply(root)

// ① 路由：pet.js + asr/asr-status/asr-prepare/tts/tts-voices
const EXPECTED = [
  '/dsh-pet/pet.js',
  '/dsh-pet/asr',
  '/dsh-pet/asr/status',
  '/dsh-pet/asr/prepare',
  '/dsh-pet/tts',
  '/dsh-pet/tts/voices',
  '/dsh-pet/tts/custom',
  '/dsh-pet/gpt/status',
  '/dsh-pet/gpt/install',
  '/dsh-pet/gpt/start',
  '/dsh-pet/gpt/cancel',
  '/dsh-pet/gpt/autostart',
]
assert.equal(handlers.length, EXPECTED.length, '应注册 ' + EXPECTED.length + ' 条路由，实际 ' + handlers.length)
for (const p of EXPECTED) assert.ok(handlers.find((h) => h.path === p), '缺少路由 ' + p)
const petRoute = handlers.find((h) => h.path === '/dsh-pet/pet.js')
const asrRoute = handlers.find((h) => h.path === '/dsh-pet/asr')
assert.ok(petRoute, '缺少 /dsh-pet/pet.js 路由')
assert.ok(asrRoute, '缺少 /dsh-pet/asr 路由')
assert.equal(petRoute.kind, 'exact')
assert.equal(asrRoute.kind, 'exact')

// ② 路由能吐出脚本
const served = await new Promise((resolve, reject) => {
  const res = {
    writeHead() {},
    end(body) { resolve(String(body || '')) },
  }
  try { petRoute.handler({}, res) } catch (err) { reject(err) }
})
assert.ok(served.length > 2000, 'widget 脚本不应为空，实际长度 ' + served.length)
assert.ok(served.includes('dshpet-root'), '脚本应包含宠物根节点类名')
assert.ok(served.includes('data-chat-flow-kind'), '朗读应锁定聊天流的回答节点（不再念整页文字）')
assert.ok(served.includes('/dsh-pet/tts/custom'), '脚本应支持自定义 TTS 引擎')
assert.ok(!/^\s*import\s/m.test(served), '脚本不能含 ESM import（浏览器 <script> 直接加载）')
assert.ok(!served.includes('export '), '脚本不能含 export')

// ③ tapIndex 注入
assert.equal(taps.length, 1, '应注册 1 个 index 变换')
const html = taps[0]('<html><body><div id="app"></div></body></html>')
assert.ok(html.includes('<script defer src="/dsh-pet/pet.js"></script>'), '应注入 script 标签')
assert.equal(taps[0](html), html, '重复调用不应重复注入（幂等）')

// ④ 桌面端注入行
const table = []
for (const cb of eventHandlers['webserver/index-inject'] || []) cb(table)
assert.equal(table.length, 1, '应推入 1 行注入')
assert.equal(table[0].kind, 'script', '桌面端必须用内联 script 行，避免 script-src 加载失败拖垮启动')
assert.ok(table[0].text.includes('/dsh-pet/pet.js'), '注入行应指向 pet.js')
// 幂等：再来一次不应重复
for (const cb of eventHandlers['webserver/index-inject'] || []) cb(table)
assert.equal(table.length, 1, '重复收集不应重复推入')

console.log('✅ 宿主插件自检通过：路由 /dsh-pet/pet.js，脚本 %d 字节，注入行 %d 条', served.length, table.length)
