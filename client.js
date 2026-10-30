/* 大肥鱼语音宠物 —— 浏览器侧脚本（由 Host 插件以 /dsh-pet/pet.js 提供）
 * 纯 IIFE，无模块语法：被 <script src> 直接加载。
 * 功能：
 *   1. 右下角浮动小宠物（SVG 大肥鱼），可拖动；
 *   2. 点一下 / 点麦克风按钮 → Web Speech Recognition（zh-CN）识别 → 自动填入对话框并发送；
 *   3. 发送后监听页面文本变化，等它稳定下来 → 取新增文本 → SpeechSynthesis 念出来；
 *   4. 喇叭按钮可静音；全局只挂载一次。
 */
(function () {
  if (window.__dshPetFishMounted) return
  window.__dshPetFishMounted = true

  const SCRIPT_TAG_ID = 'dsh-pet-fish-root'
  const LOG = (...a) => { try { console.log('%c[大肥鱼]', 'color:#4bb3fd', ...a) } catch (e) {} }

  // ---------- 配置 ----------
  const cfg = {
    lang: 'zh-CN',
    ttsEnabled: true,
    ttsRate: 1.05,
    autoSend: true,
    quietMs: 700,
    engine: 'browser',   // browser = 浏览器自带合成；sapi = 宿主调 Windows SAPI；custom = 自定义 TTS 服务（可克隆音色）
    sapiVoice: '',       // Windows 音色名，空 = 系统默认
    pitch: 0,            // 音调偏移（%），Windows 引擎用 SSML prosody 实现
    customEndpoint: 'http://127.0.0.1:9880/tts', // 自定义 TTS 地址（能返回音频字节的 POST 接口）
    customKey: '',       // 可选：Bearer Key
    customModel: '',     // 可选：模型名，填进模板 {{model}}
    customVoice: '',     // 可选：音色名，填进模板 {{voice}}
    customRefAudio: '',  // GPT-SoVITS：参考音频路径。默认留空 → 走 OpenAI 兼容请求体；填了就按 GPT-SoVITS 形状拼
    customPromptText: '', // GPT-SoVITS：参考音频里说的那句话，填进模板 {{promptText}}
    customLang: 'auto',  // 朗读语言：auto / zh / ja / en，GPT-SoVITS 的 text_lang
    customPromptLang: 'ja', // 参考音频语言：GPT-SoVITS 的 prompt_lang
    customTemplate: '',  // 可选：请求体模板，空 = 有参考音频按 GPT-SoVITS，否则 OpenAI 兼容形状
  }
  try {
    const saved = JSON.parse(localStorage.getItem('dsh-pet-fish-cfg') || '{}')
    Object.assign(cfg, saved && typeof saved === 'object' ? saved : {})
  } catch (e) {}
  // 老配置里这些键可能是空串，补一个能用的默认值（不写死任何本机路径，换台电脑也能跑）
  if (!cfg.customPromptLang) cfg.customPromptLang = 'ja'
  if (!cfg.customLang) cfg.customLang = 'auto'
  if (!cfg.customEndpoint) cfg.customEndpoint = 'http://127.0.0.1:9880/tts'
  const saveCfg = () => { try { localStorage.setItem('dsh-pet-fish-cfg', JSON.stringify(cfg)) } catch (e) {} }

  // ---------- 样式 ----------
  const CSS = `
  .dshpet-root{position:fixed;right:18px;bottom:18px;z-index:2147483000;display:flex;flex-direction:column;
    align-items:flex-end;gap:8px;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;user-select:none;
    -webkit-user-select:none;touch-action:none}
  .dshpet-bubble{max-width:250px;background:rgba(28,32,38,.94);color:#eaf2ff;border:1px solid rgba(120,190,255,.35);
    border-radius:12px;padding:7px 10px;font-size:12px;line-height:1.45;box-shadow:0 6px 22px rgba(0,0,0,.32);
    white-space:pre-wrap;word-break:break-word;opacity:0;transform:translateY(6px);transition:.18s;pointer-events:none}
  .dshpet-bubble.show{opacity:1;transform:translateY(0)}
  .dshpet-fish{cursor:grab;filter:drop-shadow(0 6px 10px rgba(0,0,0,.42));transition:transform .15s;
    display:flex;align-items:flex-end}
  .dshpet-avatar{height:112px;width:auto;display:block;pointer-events:none;
    -webkit-user-drag:none;user-select:none}
  .dshpet-fish:hover{transform:scale(1.06)}
  .dshpet-fish.listening{animation:dshpet-bob .7s ease-in-out infinite}
  .dshpet-fish.speaking{animation:dshpet-pulse 1s ease-in-out infinite}
  @keyframes dshpet-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px) scale(1.03)}}
  @keyframes dshpet-pulse{0%,100%{filter:drop-shadow(0 0 0 rgba(80,200,255,0))}50%{filter:drop-shadow(0 0 12px rgba(80,200,255,.9))}}
  .dshpet-actions{display:flex;gap:6px;align-items:center;background:rgba(20,24,30,.9);
    border:1px solid rgba(120,190,255,.28);border-radius:999px;padding:4px 6px;box-shadow:0 4px 16px rgba(0,0,0,.3)}
  .dshpet-btn{width:26px;height:26px;border:none;border-radius:50%;background:rgba(80,160,240,.18);color:#cfe6ff;
    font-size:13px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
  .dshpet-btn:hover{background:rgba(80,160,240,.34)}
  .dshpet-btn.on{background:rgba(80,200,140,.45);color:#eafff4}
  .dshpet-btn:disabled{opacity:.4;cursor:not-allowed}
  .dshpet-panel{background:rgba(20,24,30,.96);border:1px solid rgba(120,190,255,.3);border-radius:12px;
    padding:9px 10px;font-size:11px;color:#cfe6ff;display:flex;flex-direction:column;gap:7px;width:210px;
    box-shadow:0 8px 24px rgba(0,0,0,.42)}
  .dshpet-panel[hidden]{display:none}
  .dshpet-panel label{display:flex;flex-direction:column;gap:3px;line-height:1.3}
  .dshpet-panel select,.dshpet-panel input[type=range],.dshpet-panel input[type=text],.dshpet-panel textarea{width:100%;font-size:11px;background:rgba(255,255,255,.08);
    color:#dff0ff;border:1px solid rgba(120,190,255,.25);border-radius:6px;padding:2px 4px}
  .dshpet-panel textarea{resize:vertical;font-family:ui-monospace,Consolas,monospace;line-height:1.3}
  .dshpet-panel select option{background:#161b22;color:#dff0ff}
  .dshpet-panel-row{display:flex;gap:6px}
  .dshpet-panel-row button{flex:1;background:rgba(80,160,240,.22);color:#dff0ff;border:none;border-radius:6px;
    padding:4px 6px;font-size:11px;cursor:pointer}
  .dshpet-panel-row button:hover{background:rgba(80,160,240,.42)}
  .dshpet-hint{opacity:.62;font-size:10px;line-height:1.35}
  .dshpet-speech-log{opacity:.72;font-size:10px;line-height:1.4;white-space:pre-wrap;word-break:break-all;max-height:88px;overflow:auto;background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.12);border-radius:6px;padding:5px 6px;font-family:ui-monospace,Consolas,monospace}
  `

  function injectCss() {
    if (document.getElementById('dshpet-style')) return
    const st = document.createElement('style')
    st.id = 'dshpet-style'
    st.textContent = CSS
    ;(document.head || document.documentElement).appendChild(st)
  }

  // ---------- 形象：用户给的立绘（已去背景，PNG 200px 宽内嵌成 data URI，免服务器路由） ----------
  const PET_IMG = 'data:image/png;base64,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'

  // ---------- DOM ----------
  let root, fishEl, bubbleEl, micBtn, muteBtn, cfgBtn
  let panelEl, engineSel, voiceSel, rateInput, rateVal, gearBtn
  let pitchInput, pitchVal
  let customBox = null, customUrlEl = null, customKeyEl = null, customModelEl = null, customVoiceEl = null, customTplEl = null
  let customRefEl = null, customPromptEl = null
  let customLangEl = null, customPromptLangEl = null
  let bubbleTimer = null

  function buildUi() {
    root = document.createElement('div')
    root.className = 'dshpet-root'
    root.id = SCRIPT_TAG_ID
    root.innerHTML = `
      <div class="dshpet-panel" id="dshpet-panel" hidden>
        <label>朗读引擎
          <select id="dshpet-engine">
            <option value="browser">浏览器自带</option>
            <option value="sapi">Windows 本机（音色多）</option>
            <option value="custom">自定义 TTS（克隆音色）</option>
          </select>
        </label>
        <label>音色（Windows）
          <select id="dshpet-voice"><option value="">默认音色</option></select>
        </label>
        <div id="dshpet-custom" hidden>
          <label>自定义 TTS 地址
            <input type="text" id="dshpet-custom-url" placeholder="http://127.0.0.1:9880/tts">
          </label>
          <label>参考音频路径（GPT-SoVITS 用，可空）
            <input type="text" id="dshpet-custom-ref" placeholder="D:/GPT-SoVITS/voices/your_ref.wav（留空=OpenAI 兼容）">
          </label>
          <label>参考文字（上面那段音频里说的原话）
            <input type="text" id="dshpet-custom-prompt" placeholder="要和参考音频里说的一模一样">
          </label>
          <div class="dshpet-panel-row">
            <label>朗读语言
              <select id="dshpet-custom-lang">
                <option value="auto">自动识别</option>
                <option value="zh">中文</option>
                <option value="ja">日文</option>
                <option value="en">英文</option>
              </select>
            </label>
            <label>参考音频语言
              <select id="dshpet-custom-plang">
                <option value="ja">日文</option>
                <option value="zh">中文</option>
                <option value="en">英文</option>
                <option value="yue">粤语</option>
                <option value="ko">韩语</option>
              </select>
            </label>
          </div>
          <label>API Key（可空）
            <input type="text" id="dshpet-custom-key" placeholder="sk-...">
          </label>
          <div class="dshpet-panel-row">
            <label>模型
              <input type="text" id="dshpet-custom-model" placeholder="tts-1">
            </label>
            <label>音色
              <input type="text" id="dshpet-custom-voice" placeholder="xiaoxin">
            </label>
          </div>
          <label>请求体模板（含 {{text}}）
            <textarea id="dshpet-custom-tpl" rows="3" placeholder='留空 = {"model":"{{model}}","input":"{{text}}","voice":"{{voice}}","response_format":"mp3"}'></textarea>
          </label>
        </div>
        <label>语速 <span id="dshpet-rate-val">1.05</span>×
          <input type="range" id="dshpet-rate" min="0.6" max="1.8" step="0.05">
        </label>
        <label>音调 <span id="dshpet-pitch-val">0</span>%
          <input type="range" id="dshpet-pitch" min="-30" max="30" step="2">
        </label>
        <div class="dshpet-panel-row">
          <button id="dshpet-try">试听</button>
          <button id="dshpet-close">收起</button>
        </div>
        <div class="dshpet-panel-row">
          <button id="dshpet-prepare">下载识别模型</button>
        </div>
        <div class="dshpet-hint" id="dshpet-asr-hint">识别引擎状态：读取中……</div>
        <div class="dshpet-hint" id="dshpet-speech-hint">朗读状态：读取中……</div>
        <div class="dshpet-panel-row">
          <button id="dshpet-probe">体检朗读链路</button>
          <button id="dshpet-test-speak">测试朗读</button>
        </div>
        <div class="dshpet-speech-log" id="dshpet-speech-log">朗读日志：（空）</div>
        <div class="dshpet-hint">音色不够用就在 Windows「设置 → 时间和语言 → 语音」里装中文语音包，装完点 ⚙ 会自己读到。识别引擎自动：优先本机 SenseVoice 模型（准），没好就先用 Windows SAPI 顶着。</div>
      </div>
      <div class="dshpet-bubble" id="dshpet-bubble"></div>
      <div style="display:flex;align-items:flex-end;gap:8px">
        <div class="dshpet-actions">
          <button class="dshpet-btn" id="dshpet-mic" title="说话（语音输入并发送）">🎤</button>
          <button class="dshpet-btn" id="dshpet-mute" title="静音/取消静音">🔊</button>
          <button class="dshpet-btn" id="dshpet-cfg" title="自动发送：开">⏎</button>
          <button class="dshpet-btn" id="dshpet-stop" title="停止这次朗读（不影响下一条）">⏹</button>
          <button class="dshpet-btn" id="dshpet-gear" title="音色与语速">⚙</button>
        </div>
        <div class="dshpet-fish" id="dshpet-fish" title="点我说话"><img class="dshpet-avatar" src="${PET_IMG}" alt="" draggable="false"></div>
      </div>`
    document.body.appendChild(root)
    fishEl = root.querySelector('#dshpet-fish')
    bubbleEl = root.querySelector('#dshpet-bubble')
    micBtn = root.querySelector('#dshpet-mic')
    muteBtn = root.querySelector('#dshpet-mute')
    cfgBtn = root.querySelector('#dshpet-cfg')
    panelEl = root.querySelector('#dshpet-panel')
    engineSel = root.querySelector('#dshpet-engine')
    voiceSel = root.querySelector('#dshpet-voice')
    rateInput = root.querySelector('#dshpet-rate')
    rateVal = root.querySelector('#dshpet-rate-val')
    pitchInput = root.querySelector('#dshpet-pitch')
    pitchVal = root.querySelector('#dshpet-pitch-val')

    micBtn.onclick = () => toggleListen()
    const stopBtn = root.querySelector('#dshpet-stop')
    if (stopBtn) stopBtn.onclick = () => stopAnswerSpeech()
    fishEl.onclick = () => { if (!dragMoved) toggleListen() }
    muteBtn.onclick = () => {
      cfg.ttsEnabled = !cfg.ttsEnabled
      saveCfg()
      if (!cfg.ttsEnabled) stopSpeak()
      syncButtons()
      say(cfg.ttsEnabled ? '哼，本鱼开嗓了。' : '……那本鱼闭嘴。')
    }
    cfgBtn.onclick = () => {
      cfg.autoSend = !cfg.autoSend
      saveCfg()
      syncButtons()
      say(cfg.autoSend ? '说完自动发出去。' : '只填进输入框，你自己按发送。')
    }
    gearBtn = root.querySelector('#dshpet-gear')
    gearBtn.onclick = () => {
      const open = panelEl.hidden
      panelEl.hidden = !open
      gearBtn.classList.toggle('on', open)
      if (open) { loadVoices(); refreshAsrHint(); updateSpeechHint() }
    }
    engineSel.onchange = () => {
      cfg.engine = engineSel.value === 'custom' ? 'custom' : (engineSel.value === 'sapi' ? 'sapi' : 'browser')
      saveCfg()
      syncEngineUi()
      if (cfg.engine === 'sapi') { loadVoices(); say('换成 Windows 本机朗读，音色可以在下面挑。') }
      else if (cfg.engine === 'custom') {
        say(cfg.customEndpoint ? '自定义 TTS 引擎已就绪。' : '先把 TTS 地址填上，不然本鱼没嗓子。', 5000)
      }
      else say('换回浏览器自带朗读。')
    }
    customUrlEl = root.querySelector('#dshpet-custom-url')
    customKeyEl = root.querySelector('#dshpet-custom-key')
    customModelEl = root.querySelector('#dshpet-custom-model')
    customVoiceEl = root.querySelector('#dshpet-custom-voice')
    customTplEl = root.querySelector('#dshpet-custom-tpl')
    customRefEl = root.querySelector('#dshpet-custom-ref')
    customPromptEl = root.querySelector('#dshpet-custom-prompt')
    customLangEl = root.querySelector('#dshpet-custom-lang')
    customPromptLangEl = root.querySelector('#dshpet-custom-plang')
    customBox = root.querySelector('#dshpet-custom')
    const bindCustom = (el, key) => {
      if (!el) return
      el.oninput = () => { cfg[key] = String(el.value || '').trim(); saveCfg() }
      el.onchange = el.oninput
    }
    bindCustom(customUrlEl, 'customEndpoint')
    bindCustom(customKeyEl, 'customKey')
    bindCustom(customModelEl, 'customModel')
    bindCustom(customVoiceEl, 'customVoice')
    bindCustom(customRefEl, 'customRefAudio')
    bindCustom(customPromptEl, 'customPromptText')
    bindCustom(customLangEl, 'customLang')
    bindCustom(customPromptLangEl, 'customPromptLang')
    if (customTplEl) {
      customTplEl.oninput = () => { cfg.customTemplate = String(customTplEl.value || ''); saveCfg() }
    }
    if (customUrlEl) customUrlEl.value = cfg.customEndpoint || ''
    if (customKeyEl) customKeyEl.value = cfg.customKey || ''
    if (customModelEl) customModelEl.value = cfg.customModel || ''
    if (customVoiceEl) customVoiceEl.value = cfg.customVoice || ''
    if (customRefEl) customRefEl.value = cfg.customRefAudio || ''
    if (customPromptEl) customPromptEl.value = cfg.customPromptText || ''
    if (customLangEl) customLangEl.value = cfg.customLang || 'auto'
    if (customPromptLangEl) customPromptLangEl.value = cfg.customPromptLang || 'ja'
    if (customTplEl) customTplEl.value = cfg.customTemplate || ''
    voiceSel.onchange = () => {
      cfg.sapiVoice = voiceSel.value || ''
      saveCfg()
    }
    rateInput.oninput = () => {
      cfg.ttsRate = Number(rateInput.value) || 1.05
      if (rateVal) rateVal.textContent = cfg.ttsRate.toFixed(2)
      saveCfg()
    }
    pitchInput.oninput = () => {
      cfg.pitch = Number(pitchInput.value) || 0
      if (pitchVal) pitchVal.textContent = String(Math.round(cfg.pitch))
      saveCfg()
    }
    root.querySelector('#dshpet-try').onclick = () => {
      const sample = '哼，本鱼试个音——听见了没有？'
      ensureAudible()
      feedSpeech('try-' + Date.now(), sample, true)
    }
    // 测试朗读：走和真回答完全同一条流水线，用来分清「没抓到回答」还是「播不出来」
    const testBtn = root.querySelector('#dshpet-test-speak')
    if (testBtn) testBtn.onclick = () => {
      ensureAudible()
      logSpeech('手动测试朗读')
      feedSpeech('test-' + Date.now(), '这是测试朗读，一二三四五。', true)
    }
    // 显式的「试听 / 测试朗读」永远应该出声：静音状态下自己开嗓，省得以为坏了
    function ensureAudible() {
      if (cfg.ttsEnabled) return
      cfg.ttsEnabled = true
      saveCfg()
      syncButtons()
      say('刚才是静音状态，本鱼自己开嗓了。', 5000)
      logSpeech('静音 → 自动开嗓')
    }
    // 体检：不动语音链路，只把「自定义 TTS 端点」到底通不通问出来
    root.querySelector('#dshpet-probe').onclick = async () => {
      const sample = '体检一下链路。'
      updateSpeechHint('体检中……')
      if (cfg.engine !== 'custom') { updateSpeechHint('当前不是自定义 TTS 引擎，体检只看这个'); return }
      try {
        const resp = await fetch(TTS_CUSTOM_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(customPayload(sample)),
        })
        if (!resp.ok) {
          const detail = await resp.text().catch(() => '')
          updateSpeechHint('端点返回 HTTP ' + resp.status + ' ' + String(detail).slice(0, 90))
          return
        }
        const blob = await resp.blob()
        updateSpeechHint('端点正常，音频 ' + Math.round(blob.size / 1024) + 'KB')
      } catch (err) {
        updateSpeechHint('请求失败：' + String((err && err.message) || err).slice(0, 90))
      }
    }
    root.querySelector('#dshpet-close').onclick = () => {
      panelEl.hidden = true
      gearBtn.classList.remove('on')
    }
    root.querySelector('#dshpet-prepare').onclick = async () => {
      const hint = root.querySelector('#dshpet-asr-hint')
      try {
        const resp = await fetch('/dsh-pet/asr/prepare', { method: 'POST' })
        const data = await resp.json().catch(() => ({}))
        if (data && data.error === 'no-service') {
          say('官方语音包还没起来……要重启 DSH 才行。', 6000)
          if (hint) hint.textContent = '识别引擎：Windows SAPI（只有装了官方语音包+重启才能换 SenseVoice）'
          return
        }
        say('开始下载语音模型，约 240MB，只下一次～', 5000)
        watchPrepare(data && data.percent)
        refreshAsrHint()
      } catch (err) {
        say('启动下载失败：' + String((err && err.message) || err), 5000)
      }
    }
    engineSel.value = cfg.engine === 'custom' ? 'custom' : (cfg.engine === 'sapi' ? 'sapi' : 'browser')
    syncEngineUi()
    rateInput.value = String(cfg.ttsRate)
    if (rateVal) rateVal.textContent = cfg.ttsRate.toFixed(2)
    pitchInput.value = String(cfg.pitch || 0)
    if (pitchVal) pitchVal.textContent = String(Math.round(cfg.pitch || 0))
    if (cfg.engine === 'sapi') setTimeout(loadVoices, 400)
    syncButtons()
    makeDraggable()
  }

  function syncEngineUi() {
    if (engineSel) engineSel.value = cfg.engine === 'custom' ? 'custom' : (cfg.engine === 'sapi' ? 'sapi' : 'browser')
    if (customBox) customBox.hidden = cfg.engine !== 'custom'
  }

  function syncButtons() {
    if (!muteBtn) return
    muteBtn.textContent = cfg.ttsEnabled ? '🔊' : '🔇'
    muteBtn.classList.toggle('on', cfg.ttsEnabled)
    cfgBtn.textContent = cfg.autoSend ? '⏎' : '✍'
    cfgBtn.classList.toggle('on', cfg.autoSend)
    cfgBtn.title = cfg.autoSend ? '自动发送：开' : '自动发送：关（只填输入框）'
    micBtn.disabled = !micSupported()
  }

  function say(text, ms) {
    if (!bubbleEl || !text) return
    bubbleEl.textContent = text
    bubbleEl.classList.add('show')
    clearTimeout(bubbleTimer)
    bubbleTimer = setTimeout(() => bubbleEl.classList.remove('show'), ms || 4200)
  }

  // ---------- 拖动 ----------
  let dragMoved = false
  function makeDraggable() {
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false
    fishEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      dragging = true; dragMoved = false
      sx = e.clientX; sy = e.clientY
      const r = root.getBoundingClientRect()
      ox = r.right; oy = r.bottom
      fishEl.style.cursor = 'grabbing'
      try { fishEl.setPointerCapture(e.pointerId) } catch (err) {}
    })
    fishEl.addEventListener('pointermove', (e) => {
      if (!dragging) return
      const dx = sx - e.clientX, dy = sy - e.clientY
      if (Math.abs(dx) + Math.abs(dy) > 5) dragMoved = true
      if (!dragMoved) return
      const right = Math.max(6, Math.min(window.innerWidth - 50, ox + dx))
      const bottom = Math.max(6, Math.min(window.innerHeight - 50, oy + dy))
      root.style.right = right + 'px'
      root.style.bottom = bottom + 'px'
    })
    const end = () => {
      if (!dragging) return
      dragging = false
      fishEl.style.cursor = 'grab'
      if (dragMoved) {
        try {
          localStorage.setItem('dsh-pet-fish-pos', JSON.stringify({
            right: root.style.right, bottom: root.style.bottom,
          }))
        } catch (err) {}
        setTimeout(() => { dragMoved = false }, 60)
      }
    }
    fishEl.addEventListener('pointerup', end)
    fishEl.addEventListener('pointercancel', end)
    try {
      const pos = JSON.parse(localStorage.getItem('dsh-pet-fish-pos') || '{}')
      if (pos.right) root.style.right = pos.right
      if (pos.bottom) root.style.bottom = pos.bottom
    } catch (e) {}
  }

  // ---------- 语音识别 ----------
  // 桌面端（Electron）没有 Google 语音密钥：webkitSpeechRecognition 点了「在听」却永远收不到结果。
  // 所以改成——浏览器只负责录音（16k 单声道 WAV），识别交给宿主插件的 /dsh-pet/asr
  //（Windows SAPI 本地识别，离线、中文，不需要任何 key）。
  const ASR_URL = '/dsh-pet/asr'
  const TARGET_RATE = 16000
  let mediaStream = null, audioCtx = null, processor = null, sourceNode = null, sinkGain = null
  let listening = false, transcribing = false
  let pcmChunks = [], inputRate = 48000
  let speechHeard = false, lastVoiceAt = 0, startedAt = 0, lastPaint = 0, watchTimer = null

  function micSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
  }

  async function startListen() {
    if (listening || transcribing) return
    if (!micSupported()) {
      say('这个页面拿不到麦克风……要 127.0.0.1 或 https 才行。')
      return
    }
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch (err) {
      const n = err && err.name
      say(n === 'NotAllowedError' ? '麦克风被拦了，点地址栏的小锁允许一下。'
        : n === 'NotFoundError' ? '找不到麦克风设备……'
        : '麦克风打不开：' + String((err && err.message) || err))
      return
    }
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext
      audioCtx = new Ctx()
      if (audioCtx.state === 'suspended') { try { await audioCtx.resume() } catch (e) {} }
      inputRate = audioCtx.sampleRate || 48000
      sourceNode = audioCtx.createMediaStreamSource(mediaStream)
      processor = audioCtx.createScriptProcessor(4096, 1, 1)
      sinkGain = audioCtx.createGain()
      sinkGain.gain.value = 0 // 只为驱动节点，不把麦克风放出来（否则会啸叫）
      sourceNode.connect(processor)
      processor.connect(sinkGain)
      sinkGain.connect(audioCtx.destination)
      pcmChunks = []
      speechHeard = false
      lastVoiceAt = 0
      lastPaint = 0
      startedAt = Date.now()
      processor.onaudioprocess = onAudio
      listening = true
      fishEl.classList.add('listening')
      micBtn.classList.add('on')
      say('本鱼在听……说完停一下就好', 20000)
      watchTimer = setInterval(watchStop, 150)
    } catch (err) {
      say('录音初始化失败：' + String((err && err.message) || err))
      teardownAudio()
    }
  }

  function onAudio(e) {
    if (!listening) return
    const buf = e.inputBuffer.getChannelData(0)
    pcmChunks.push(new Float32Array(buf))
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    const rms = Math.sqrt(sum / buf.length)
    const now = Date.now()
    if (rms > 0.012) {
      speechHeard = true
      lastVoiceAt = now
    }
    if (now - lastPaint > 150 && bubbleEl && bubbleEl.classList.contains('show')) {
      lastPaint = now
      const bars = Math.max(1, Math.min(9, Math.round(rms * 70)))
      bubbleEl.textContent = '🔴 本鱼在听 ' + '▮'.repeat(bars)
    }
  }

  function watchStop() {
    if (!listening) return
    const now = Date.now()
    // 说完静了 1.4 秒 → 收工；一直没声 7 秒 → 收工；最长 15 秒
    if (speechHeard && now - lastVoiceAt > 1400) return finishListen()
    if (!speechHeard && now - startedAt > 7000) return finishListen()
    if (now - startedAt > 15000) return finishListen()
  }

  function stopListen() { finishListen() }

  function teardownAudio() {
    clearInterval(watchTimer)
    watchTimer = null
    listening = false
    try { if (processor) processor.onaudioprocess = null } catch (e) {}
    try { if (sourceNode) sourceNode.disconnect() } catch (e) {}
    try { if (processor) processor.disconnect() } catch (e) {}
    try { if (sinkGain) sinkGain.disconnect() } catch (e) {}
    try { if (audioCtx) audioCtx.close() } catch (e) {}
    try { if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop()) } catch (e) {}
    processor = sourceNode = sinkGain = audioCtx = mediaStream = null
    if (fishEl) fishEl.classList.remove('listening')
    if (micBtn) micBtn.classList.remove('on')
  }

  function concatF32(list) {
    let total = 0
    for (const c of list) total += c.length
    const out = new Float32Array(total)
    let off = 0
    for (const c of list) { out.set(c, off); off += c.length }
    return out
  }

  function downsample(samples, from, to) {
    if (to >= from) return samples
    const ratio = from / to
    const outLen = Math.floor(samples.length / ratio)
    const out = new Float32Array(outLen)
    for (let i = 0; i < outLen; i++) {
      const start = Math.floor(i * ratio)
      const end = Math.min(samples.length, Math.floor((i + 1) * ratio))
      let sum = 0
      for (let j = start; j < end; j++) sum += samples[j]
      out[i] = sum / Math.max(1, end - start)
    }
    return out
  }

  function encodeWav(samples, rate) {
    const bytes = new ArrayBuffer(44 + samples.length * 2)
    const dv = new DataView(bytes)
    const str = (off, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)) }
    str(0, 'RIFF')
    dv.setUint32(4, 36 + samples.length * 2, true)
    str(8, 'WAVE')
    str(12, 'fmt ')
    dv.setUint32(16, 16, true)
    dv.setUint16(20, 1, true)                 // PCM
    dv.setUint16(22, 1, true)                 // 单声道
    dv.setUint32(24, rate, true)
    dv.setUint32(28, rate * 2, true)          // byteRate
    dv.setUint16(32, 2, true)                 // blockAlign
    dv.setUint16(34, 16, true)                // 16 bit
    str(36, 'data')
    dv.setUint32(40, samples.length * 2, true)
    let off = 44
    for (let i = 0; i < samples.length; i++, off += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]))
      dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    }
    return new Blob([bytes], { type: 'audio/wav' })
  }

  async function finishListen() {
    if (!listening) return
    const heard = speechHeard
    const rate = inputRate
    const chunks = pcmChunks.slice()
    teardownAudio()
    if (!chunks.length || !heard) {
      say('……本鱼什么都没听见。', 2600)
      return
    }
    transcribing = true
    fishEl.classList.add('speaking')
    say('本鱼在想……', 20000)
    try {
      const samples = downsample(concatF32(chunks), rate, TARGET_RATE)
      const wav = encodeWav(samples, TARGET_RATE)
      const resp = await fetch(ASR_URL + '?lang=' + encodeURIComponent(cfg.lang), {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: wav,
      })
      const data = await resp.json().catch(() => ({}))
      if (data && data.preparing) watchPrepare(data.percent)
      if (data && data.ok && data.text) {
        handleUtterance(String(data.text).trim())
      } else if (data && data.error === 'busy') {
        say('本鱼还在认上一句，等一下下。', 2600)
      } else {
        say('本鱼没听懂（' + ((data && data.error) || ('HTTP ' + resp.status)) + '）', 6000)
      }
    } catch (err) {
      say('送给宿主识别失败了：' + String((err && err.message) || err), 6000)
    } finally {
      transcribing = false
      if (fishEl) fishEl.classList.remove('speaking')
    }
  }

  function toggleListen() {
    if (listening) stopListen()
    else startListen()
  }

  // ---------- 输入框操作 ----------
  function findComposer() {
    return document.querySelector('[data-composer-input]')
      || document.querySelector('textarea')
      || document.querySelector('[role="textbox"][aria-multiline="true"]')
      || document.querySelector('[contenteditable="true"]')
  }

  function setComposerText(el, text) {
    el.focus()
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const desc = Object.getOwnPropertyDescriptor(proto, 'value')
      if (desc && desc.set) desc.set.call(el, text)
      else el.value = text
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }
    // contenteditable
    try {
      const sel = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(el)
      sel.removeAllRanges()
      sel.addRange(range)
      document.execCommand('insertText', false, text)
      return true
    } catch (err) {
      el.textContent = text
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }))
      return true
    }
  }

  function pressEnter(el) {
    // 注意：KeyboardEvent 构造器会忽略 init 里的 keyCode/which（结果恒为 0），
    // 而 React 的 Enter 判定常读 nativeEvent.keyCode —— 必须用 defineProperty 补上。
    const fire = (type) => {
      const ev = new KeyboardEvent(type, { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })
      try {
        Object.defineProperty(ev, 'keyCode', { get: () => 13 })
        Object.defineProperty(ev, 'which', { get: () => 13 })
      } catch (err) {}
      el.dispatchEvent(ev)
    }
    fire('keydown')
    fire('keypress')
    fire('keyup')
  }

  function submitComposer(el) {
    const form = el.closest && el.closest('form')
    if (form && typeof form.requestSubmit === 'function') {
      try { form.requestSubmit(); return true } catch (e) {}
    }
    // 退路：找附近的发送按钮
    const seat = el.closest('[data-composer-seat],[data-composer-card]') || el.parentElement
    const btn = seat && seat.querySelector('button[type="submit"],button[aria-label*="发送"],button[aria-label*="Send"]')
    if (btn && !btn.disabled) { btn.click(); return true }
    pressEnter(el)
    return true
  }

  async function handleUtterance(text) {
    const el = findComposer()
    if (!el) {
      say('找不到输入框……本鱼迷路了。')
      return
    }
    setComposerText(el, text)
    say(text, 3000)
    if (!cfg.autoSend) {
      say(text + '\n（已填入，自己按发送～）', 6000)
      return
    }
    await sleep(90)
    watchReply(text)
    submitComposer(el)
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  // ---------- 回复朗读 ----------
  // 只念「助手这一轮的正文」：锁定 DSH 聊天流里的回答节点
  //   [data-chat-flow-kind="assistant-step"] 且不属于 reasoning 分组（思考/工具过程）
  // 时间戳、复制按钮、思考过程、工具调用都不在正文节点里，自然不会被念出来。
  const ANSWER_SELECTOR = '[data-chat-flow-kind="assistant-step"]:not([data-chat-group-part="reasoning"])'

  function answerNodes() {
    try {
      return Array.prototype.slice.call(document.querySelectorAll(ANSWER_SELECTOR))
    } catch (err) {
      return []
    }
  }

  function nodeKey(el) {
    try {
      return el.getAttribute('data-chat-flow-key') || el.getAttribute('data-chat-anchor-key') || ''
    } catch (err) {
      return ''
    }
  }

  // 取节点正文：先摘掉按钮/图标/时间这些界面零件，再取纯文本
  function answerText(el) {
    if (!el) return ''
    let clone = null
    try { clone = el.cloneNode(true) } catch (err) { return String(el.textContent || '') }
    try {
      const junk = clone.querySelectorAll('button,svg,time,[role="button"],[aria-hidden="true"],input,select')
      for (let i = 0; i < junk.length; i++) {
        try { junk[i].parentNode.removeChild(junk[i]) } catch (e) {}
      }
    } catch (e) {}
    return String(clone.textContent || '')
  }

  // 兜底过滤：纯时间行、统计行、界面词行
  function stripMetaLines(text) {
    return String(text || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !/^\d{1,2}:\d{2}(:\d{2})?(\s*[AP]M)?$/i.test(s))
      .filter((s) => !/^(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}|\d{1,2}[-/月]\d{1,2}日?)\s*(\d{1,2}:\d{2})?$/.test(s))
      .filter((s) => !/^(用时|耗时|共\s*\d+\s*tokens?|tokens?:|已复制|复制|重试|重新生成|停止生成|思考中|深度思考|编辑|删除)/i.test(s))
      .join('\n')
  }

  // ---------- 全局监听：不管你是打字的还是按🎤说话的，新回答都要念 ----------
  const spokenMap = Object.create(null)
  let lastSpoken = { h: '', at: 0 }
  let globalPrimed = false
  const hashText = (s) => {
    let h = 5381
    const str = String(s || '')
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0
    return h + ':' + str.length
  }
  // 同一条回答只念一次：不管是被发送监听抓到，还是被全局轮询抓到
  function speakOnce(key, text) {
    const clean = sanitizeAnswer(text)
    if (!clean) return false
    return feedSpeech(key, clean, true)
  }
  function sanitizeAnswer(text) {
    return stripMetaLines(String(text || '')).trim()
  }

  // 朗读链路的现场记录：出问题时不用开控制台，看 ⚙ 面板最后几行就知道卡在哪
  const speechLog = []
  let muteWarned = false
  function logSpeech(msg) {
    const t = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    speechLog.push(t + ' ' + msg)
    if (speechLog.length > 80) speechLog.shift()
    const box = root && root.querySelector('#dshpet-speech-log')
    if (box) box.textContent = '朗读日志：\n' + speechLog.slice(-6).join('\n')
    try { console.log('[pet-voice]', msg) } catch (e) {}
  }

  function armGlobalWatch() {
    // 启动时把已有历史标记成已念，别一刷新就把旧回答全读一遍
    const prime = () => {
      for (const el of answerNodes()) {
        const k = nodeKey(el) || 'last'
        spokenMap[k] = hashText(sanitizeAnswer(answerText(el)))
      }
      globalPrimed = true
      logSpeech('自检：回答节点 ' + answerNodes().length + ' 个，引擎 ' + cfg.engine + '，' + (cfg.ttsEnabled ? '非静音' : '静音中'))
    }
    setTimeout(prime, 1200)
    let poll = { key: '', text: '', at: 0 }
    // 监听里出任何岔子都不能静默死掉，出错就写到 ⚙ 的朗读状态里
    const step = () => {
      try {
        if (!globalPrimed) return
        const nodes = answerNodes()
        if (!nodes.length) return
        const el = nodes[nodes.length - 1]
        const key = nodeKey(el) || 'last'
        const text = sanitizeAnswer(answerText(el))
        if (!text) return
        if (poll.key !== key || poll.text !== text) {
          poll = { key, text, at: Date.now() }
          feedSpeech(key, text, false)     // 说完的句子先送去合成，别等整段
          return
        }
        if (Date.now() - poll.at < Math.max(500, cfg.quietMs)) return
        feedSpeech(key, text, true)        // 文本稳定了，把剩下的也投出去
      } catch (err) {
        lastSpeech.state = '朗读监听出错：' + String((err && err.message) || err).slice(0, 50)
        updateSpeechHint()
        console.error('[pet-voice] 朗读监听出错', err)
      }
    }
    setInterval(step, 600)
  }

  // 兜底：万一聊天流结构变了，退回「取页面新增文本」的老办法
  function pageText() {
    try {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (root && root.contains(node)) return NodeFilter.FILTER_REJECT
          const p = node.parentElement
          if (!p) return NodeFilter.FILTER_REJECT
          const tag = p.tagName
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA') {
            return NodeFilter.FILTER_REJECT
          }
          if (p.closest && p.closest('.dshpet-root')) return NodeFilter.FILTER_REJECT
          if (p.closest && p.closest('[data-chat-group-part="reasoning"]')) return NodeFilter.FILTER_REJECT
          return NodeFilter.FILTER_ACCEPT
        },
      })
      const out = []
      let n
      while ((n = walker.nextNode())) out.push(n.nodeValue)
      return out.join('\n')
    } catch (err) {
      return document.body.innerText || ''
    }
  }

  function watchReplyByPage(sentText) {
    if (watching) return
    watching = true
    const beforeLines = new Set(pageText().split('\n').map((s) => s.trim()).filter(Boolean))
    let lastSeen = ''
    let lastChangeAt = Date.now()
    const startedAt = Date.now()
    let spoke = false
    const timer = setInterval(() => {
      const now = pageText()
      if (now !== lastSeen) { lastSeen = now; lastChangeAt = Date.now() }
      const fresh = stripMetaLines(now.split('\n').filter((line) => !beforeLines.has(line.trim())).join('\n'))
        .split('\n').map((s) => s.trim()).filter(Boolean)
        .filter((line) => line.length >= 2)
        .filter((line) => !sentText || (line !== sentText && line.indexOf(sentText) !== 0))
      const text = fresh.join(' ').trim()
      const stable = Date.now() - lastChangeAt >= cfg.quietMs
      const tooLong = Date.now() - startedAt > 180000
      if ((stable && text && Date.now() - startedAt > 700) || tooLong) {
        clearInterval(timer)
        watching = false
        if (spoke) return
        spoke = true
        if (text) speakOnce('page-' + startedAt, text)
      }
    }, 400)
    setTimeout(() => { if (watching) { watching = false; clearInterval(timer) } }, 200000)
  }

  let watching = false
  let watchGen = 0
  function watchReply(sentText) {
    // 上一轮还在等就别硬顶，直接接管：新的一轮回答要能念出来
    const gen = ++watchGen
    watching = true
    const alive = () => gen === watchGen
    const seen = Object.create(null)
    for (const el of answerNodes()) {
      const k = nodeKey(el)
      if (k) seen[k] = true
    }
    let lastText = ''
    let lastChangeAt = Date.now()
    const startedAt = Date.now()
    let spoke = false
    const finish = (timer, text) => {
      clearInterval(timer)
      if (!alive()) return
      watching = false
      if (spoke) return
      spoke = true
      if (text) speakOnce('turn-' + gen, text)
    }
    const timer = setInterval(() => {
      if (!alive()) { clearInterval(timer); return }
      const waited = Date.now() - startedAt
      const fresh = answerNodes().filter((el) => {
        const k = nodeKey(el)
        return k ? !seen[k] : true
      })
      const text = stripMetaLines(fresh.map(answerText).join('\n')).trim()
      if (text !== lastText) { lastText = text; lastChangeAt = Date.now() }
      const quiet = Date.now() - lastChangeAt >= cfg.quietMs
      if (text && quiet && waited > 600) { finish(timer, text); return }
      if (waited > 240000) { finish(timer, text); return }
      // 12 秒还没有新回答节点：可能是界面结构变了，退回页面文本比对
      if (!text && waited > 7000) {
        clearInterval(timer)
        watching = false
        watchReplyByPage(sentText)
      }
    }, 350)
    setTimeout(() => { if (watching) { clearInterval(timer); watching = false } }, 260000)
  }

  function stripForSpeech(text) {
    return String(text || '')
      .replace(/```[\s\S]*?```/g, '（代码块）')
      .replace(/`[^`]*`/g, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s*/gm, '')
      .replace(/[*_~]{1,3}([^*_~]*)[*_~]{1,3}/g, '$1')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*>\s?/gm, '')
      .replace(/\|/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  // ---------- 句子流水线：一句一合成，边合成边播，不用等整段 ----------
  // 把长文本切成适合合成的小句：先按句末切，太长的再按逗号切
  function splitForSpeech(text) {
    const parts = String(text || '')
      .split(/(?<=[。！？!?…])\s*/)
      .map((s) => s.trim())
      .filter(Boolean)
    const out = []
    for (const p of parts) {
      if (p.length <= 38) { out.push(p); continue }
      let buf = ''
      for (const seg of p.split(/(?<=[，,、；;：:])\s*/)) {
        if ((buf + seg).length > 30 && buf) { out.push(buf); buf = seg } else buf += seg
      }
      if (buf) out.push(buf)
    }
    const merged = []
    for (const s of out) {
      if (merged.length && s.length < 6) merged[merged.length - 1] += s
      else merged.push(s)
    }
    // 第一句尽量短：开头那句等得最久，先让它快点出声
    if (merged.length > 1 && merged[0].length > 24) {
      const at = merged[0].search(/[，,、；;：:]/)
      if (at >= 6 && at < merged[0].length - 4) {
        const head = merged[0].slice(0, at + 1)
        merged.splice(0, 1, head, merged[0].slice(at + 1))
      }
    }
    // 「……」这种纯标点会被 GPT-SoVITS 判成无效文本、直接 400，所以并到前一句或直接丢掉
    const speakable = []
    for (const s of merged) {
      if (/[\p{L}\p{N}]/u.test(s)) speakable.push(s)
      else if (speakable.length) speakable[speakable.length - 1] += s
    }
    return speakable
  }

  const speechQueue = []
  let pumping = false

  // 按引擎取一段音频字节（浏览器引擎不走这里）
  async function fetchSpeechChunk(chunk) {
    if (cfg.engine === 'sapi') {
      const resp = await fetch(TTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: chunk, voice: cfg.sapiVoice || '', rate: cfg.ttsRate, pitch: cfg.pitch || 0 }),
      })
      if (!resp.ok) throw new Error('HTTP ' + resp.status + ' ' + String(await resp.text().catch(() => '')).slice(0, 90))
      return resp.blob()
    }
    const resp = await fetch(TTS_CUSTOM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(customPayload(chunk)),
    })
    if (!resp.ok) throw new Error('HTTP ' + resp.status + ' ' + String(await resp.text().catch(() => '')).slice(0, 120))
    return resp.blob()
  }

  // 播一段、等它播完（这样下一句才能无缝接上）
  // 播放有可能被浏览器拦（自动播放策略）或中途卡住，所以每个出口都要 resolve，别把流水线挂死
  function playBlobEnd(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob)
      const el = new Audio(url)
      audioEl = el
      let settled = false
      let watchdog = 0
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(watchdog)
        if (currentPlayFinish === finish) currentPlayFinish = null
        try { URL.revokeObjectURL(url) } catch (e) {}
        resolve()
      }
      currentPlayFinish = finish
      watchdog = setTimeout(finish, 90000)
      el.onended = finish
      el.onerror = () => { lastSpeech.state = '音频解码失败'; updateSpeechHint(); finish() }
      try {
        const p = el.play()
        if (p && typeof p.catch === 'function') {
          p.catch((err) => {
            const name = String((err && err.name) || err)
            lastSpeech.state = /NotAllowed/i.test(name) ? '浏览器拦了自动播放（点一下鱼）' : '播放失败：' + name
            updateSpeechHint()
            finish()
          })
        }
      } catch (e) {
        lastSpeech.state = '播放异常：' + String((e && e.message) || e)
        updateSpeechHint()
        finish()
      }
    })
  }

  function queueSpeech(chunks) {
    for (const c of chunks) speechQueue.push(c)
    logSpeech('入队 ' + chunks.length + ' 句，队列 ' + speechQueue.length)
    pump()
  }

  // 一句在播的同时，下一句已经在合成 → 听起来是连续的
  async function pump() {
    if (pumping || cfg.engine === 'browser') return
    pumping = true
    logSpeech('流水线启动（' + cfg.engine + '）')
    fishEl && fishEl.classList.add('speaking')
    try {
      let ahead = speechQueue.length ? fetchSpeechChunk(speechQueue[0]) : null
      if (ahead) ahead.catch(() => {})
      while (speechQueue.length) {
        let blob
        try {
          blob = await ahead
          speechQueue.shift()
          ahead = speechQueue.length ? fetchSpeechChunk(speechQueue[0]) : null
          if (ahead) ahead.catch(() => {})
        } catch (err) {
          speechQueue.shift()
          const emsg = String((err && err.message) || err)
          logSpeech('合成失败：' + emsg.slice(0, 70))
          ahead = speechQueue.length ? fetchSpeechChunk(speechQueue[0]) : null
          if (ahead) ahead.catch(() => {})
          // 「这句本来就没法念」（纯标点之类）不算故障，安静跳过就好
          if (/请输入有效文本|tts failed/i.test(emsg)) { lastSpeech.state = '跳过一句没法念的'; updateSpeechHint(); continue }
          onSpeechError(err)
          continue
        }
        if (!blob) continue
        logSpeech('播放一段 ' + Math.round(blob.size / 1024) + 'KB')
        await playBlobEnd(blob)
      }
    } catch (err) {
      lastSpeech.state = '流水线异常：' + String((err && err.message) || err).slice(0, 60)
      updateSpeechHint()
      console.error('[pet-voice] 朗读流水线异常', err)
    } finally {
      pumping = false
      fishEl && fishEl.classList.remove('speaking')
    }
  }

  // 合成失败就说人话，剩下的退回浏览器引擎先念完；引擎设置不动，免得一次网络抖动就被永久改掉
  function onSpeechError(err) {
    const msg = String((err && err.message) || err)
    if (/fetch failed|ECONNREFUSED|HTTP 500/i.test(msg)) {
      say('自定义语音服务连不上（' + cfg.customEndpoint + '）。先确认它开着，或者去 ⚙ 里换成别的引擎。', 9000)
      lastSpeech.state = '语音服务没开'
    } else {
      say('自定义 TTS 没通：' + msg.slice(0, 80) + '。先用浏览器声音念完这段。', 8000)
      lastSpeech.state = '合成失败：' + msg.slice(0, 40)
    }
    updateSpeechHint()
    logSpeech('合成失败退回：' + msg.slice(0, 60))
    const rest = speechQueue.splice(0).join('')
    if (rest) {
      // Electron 里浏览器引擎经常没有中文音色（等于没声音），所以先退到 Windows SAPI，它一定有声
      lastSpeech.state = (lastSpeech.state || '') + '｜改用 Windows 语音'
      updateSpeechHint()
      speakSapi(rest)
    }
  }

  // 增量投喂：文本还在长的时候，也先把已经说完的句子送去合成
  const fedMap = Object.create(null)
  function feedSpeech(key, text, final) {
    const clean0 = stripForSpeech(text)
    if (!clean0) return false
    if (!cfg.ttsEnabled) {
      lastSpeech.state = '刚才那条被静音吞了'
      updateSpeechHint()
      logSpeech('静音中，跳过')
      if (!muteWarned) {
        muteWarned = true
        say('现在是静音状态，回答不会念——点一下 🔊 开嗓。', 7000)
      }
      return false
    }
    const capped = clean0.length > 1400 ? clean0.slice(0, 1400) : clean0
    const stopAt = stoppedKeys.get(key)
    if (stopAt != null && capped.startsWith(stopAt)) {
      logSpeech('这条按过停止，跳过')
      return false
    }
    const st = fedMap[key] || (fedMap[key] = { n: 0, full: '' })
    if (!capped.startsWith(st.full)) st.n = 0        // 文本被改写，整段重投
    st.full = capped
    const chunks = splitForSpeech(capped)
    // 浏览器引擎没法「续着念」，所以只在文本稳定后一次念完
    if (cfg.engine === 'browser' && !final) return false
    let usable = final ? chunks.length : Math.max(0, chunks.length - 1)
    if (usable <= st.n) return false
    const fresh = dedupeChunks(chunks.slice(st.n, usable))
    st.n = usable
    if (!fresh.length) return false
    lastSpeech = { at: Date.now(), chars: capped.length, state: '' }
    updateSpeechHint()
    if (cfg.engine === 'browser') { speakBrowser(fresh.join('')); return true }
    logSpeech('投喂 ' + fresh.length + ' 句（' + st.n + '/' + chunks.length + (final ? ' 定稿' : ' 增量') + '）')
    queueSpeech(fresh)
    return true
  }

  // 同一段话别念两遍：两条监听通道抓到同一条回答时，用内容指纹去重
  const recentChunks = new Map()
  function dedupeChunks(list) {
    const now = Date.now()
    for (const [k, t] of recentChunks) if (now - t > 30000) recentChunks.delete(k)
    return list.filter((c) => {
      const h = hashText(c)
      if (recentChunks.has(h)) return false
      recentChunks.set(h, now)
      return true
    })
  }

  function speakClean(text) {
    const clean = stripForSpeech(text)
    if (!clean) {
      lastSpeech.state = '抓到回答但剥完是空的'
      updateSpeechHint()
      return
    }
    lastSpeech = { at: Date.now(), chars: clean.length, state: '' }
    updateSpeechHint()
    if (clean.length > 1200) return speak(clean.slice(0, 1200) + '……剩下的你自己看吧。')
    speak(clean)
  }

  const TTS_URL = '/dsh-pet/tts'
  const TTS_CUSTOM_URL = '/dsh-pet/tts/custom'
  const TTS_VOICES_URL = '/dsh-pet/tts/voices'
  const ASR_STATUS_URL = '/dsh-pet/asr/status'
  let audioEl = null
  let ttsSeq = 0
  let voicesLoaded = false
  let currentPlayFinish = null           // 正在播的那一段的「收尾函数」，按停止时用它把流水线叫醒
  const stoppedKeys = new Map()          // 被按过停止的回答：key → 停下时读到的正文前缀，之后不再续念

  // 拉 Windows 上装了哪些朗读音色（SAPI），填进 ⚙ 面板
  async function loadVoices() {
    if (!voiceSel) return
    if (voicesLoaded) return
    voicesLoaded = true
    voiceSel.innerHTML = '<option value="">加载中……</option>'
    try {
      const resp = await fetch(TTS_VOICES_URL, { cache: 'no-store' })
      const data = await resp.json().catch(() => ({}))
      const list = (data && data.voices) || []
      if (!list.length) {
        voiceSel.innerHTML = '<option value="">（这台机器没装 Windows 音色）</option>'
        say('没找到 Windows 朗读音色……可以装一个中文语音包，或者用浏览器自带。', 6000)
        return
      }
      voiceSel.innerHTML = '<option value="">默认音色</option>' + list.map((v) => {
        const label = (v.name || '') + (v.culture ? ' · ' + v.culture : '') + (v.gender ? ' · ' + v.gender : '')
        return '<option value="' + String(v.name || '').replace(/"/g, '&quot;') + '">' + label + '</option>'
      }).join('')
      voiceSel.value = cfg.sapiVoice || ''
    } catch (err) {
      voicesLoaded = false
      voiceSel.innerHTML = '<option value="">（取音色失败）</option>'
    }
  }

  function pickVoice() {
    const vs = window.speechSynthesis ? window.speechSynthesis.getVoices() : []
    if (!vs || !vs.length) return null
    return vs.find((v) => /zh[-_]CN/i.test(v.lang) && /(Xiaoxiao|Yaoyao|Huihui|Kangkang|Tingting|Mei|Yun)/i.test(v.name))
      || vs.find((v) => /zh[-_]CN/i.test(v.lang))
      || vs.find((v) => /^zh/i.test(v.lang))
      || null
  }

  function speakBrowser(text) {
    if (!window.speechSynthesis || !text) return
    try {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(String(text))
      u.lang = cfg.lang
      u.rate = cfg.ttsRate
      const v = pickVoice()
      if (v) u.voice = v
      u.onstart = () => fishEl && fishEl.classList.add('speaking')
      u.onend = u.onerror = () => fishEl && fishEl.classList.remove('speaking')
      window.speechSynthesis.speak(u)
    } catch (err) {}
  }

  // 播放宿主/服务端返回的音频字节
  async function playBlob(blob, seq) {
    if (seq !== ttsSeq) return
    if (audioEl) { try { audioEl.pause() } catch (e) {} }
    const url = URL.createObjectURL(blob)
    audioEl = new Audio(url)
    const done = () => {
      if (fishEl) fishEl.classList.remove('speaking')
      try { URL.revokeObjectURL(url) } catch (e) {}
    }
    audioEl.onended = done
    audioEl.onerror = () => { done(); say('这段音频播不出来……格式可能不被浏览器支持。', 5000) }
    await audioEl.play()
  }

  // 走宿主：Windows SAPI 合成 WAV → 浏览器播放（音色可选、语速可调）
  async function speakSapi(text) {
    const clean = String(text || '')
    if (!clean) return
    const seq = ++ttsSeq
    try {
      fishEl && fishEl.classList.add('speaking')
      const resp = await fetch(TTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: clean.slice(0, 3500), voice: cfg.sapiVoice || '', rate: cfg.ttsRate, pitch: cfg.pitch || 0 }),
      })
      if (!resp.ok) {
        const detail = await resp.text().catch(() => '')
        throw new Error('HTTP ' + resp.status + ' ' + String(detail).slice(0, 90))
      }
      await playBlob(await resp.blob(), seq)
    } catch (err) {
      if (fishEl) fishEl.classList.remove('speaking')
      const msg = String((err && err.message) || err)
      // 只这一次改用浏览器声音，绝不把引擎设置永久改掉（改了就再也没声音了）
      say('Windows 朗读这次没成（' + msg.slice(0, 60) + '），这一段先用别的办法。', 6000)
      logSpeech('SAPI 失败：' + msg.slice(0, 60))
      speakBrowser(clean)
    }
  }

  // 走宿主代理：自定义 TTS 服务（GPT-SoVITS / CosyVoice / 任何返回音频的接口）→ 浏览器播放
  // 拼「自定义 TTS」的请求体：填了参考音频就当 GPT-SoVITS 用，否则按 OpenAI 兼容形状
  function customPayload(text) {
    let tpl = cfg.customTemplate || ''
    if (!tpl && cfg.customRefAudio) {
      tpl = JSON.stringify({
        text: '{{text}}',
        text_lang: cfg.customLang || 'auto',
        ref_audio_path: cfg.customRefAudio,
        prompt_text: cfg.customPromptText || '',
        prompt_lang: cfg.customPromptLang || 'ja',
        media_type: 'wav',
        streaming_mode: false,
        text_split_method: 'cut5',
        speed_factor: Number(cfg.ttsRate) || 1,
      })
    }
    return {
      text: String(text || '').slice(0, 3500),
      endpoint: cfg.customEndpoint,
      apiKey: cfg.customKey || '',
      model: cfg.customModel || '',
      voice: cfg.customVoice || '',
      refAudio: cfg.customRefAudio || '',
      promptText: cfg.customPromptText || '',
      bodyTemplate: tpl,
    }
  }

  async function speakCustom(text) {
    const clean = String(text || '')
    if (!clean) return
    if (!cfg.customEndpoint) {
      say('还没填 TTS 地址呢……⚙ 里填一个再试。', 6000)
      return
    }
    const seq = ++ttsSeq
    try {
      fishEl && fishEl.classList.add('speaking')
      const resp = await fetch(TTS_CUSTOM_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(customPayload(clean)),
      })
      if (!resp.ok) {
        const detail = await resp.text().catch(() => '')
        throw new Error('HTTP ' + resp.status + ' ' + String(detail).slice(0, 120))
      }
      await playBlob(await resp.blob(), seq)
    } catch (err) {
      if (fishEl) fishEl.classList.remove('speaking')
      const msg = String((err && err.message) || err)
      // fetch failed / 500 基本就是 9880 上的语音服务没开，直说人话
      if (/fetch failed|ECONNREFUSED|HTTP 500/i.test(msg)) {
        say('自定义语音服务连不上（' + cfg.customEndpoint + '）。先确认它开着，或者去 ⚙ 里换成别的引擎。', 9000)
      } else {
        say('自定义 TTS 没通：' + msg.slice(0, 80) + '。这次先用浏览器声音。', 8000)
      }
      speakBrowser(clean)
    }
  }

  // 朗读链路状态：谁被抓到、谁被静音吞掉，都记一笔，方便一眼看出卡在哪
  let lastSpeech = { at: 0, chars: 0, state: '' }
  function updateSpeechHint(extra) {
    const hint = root && root.querySelector('#dshpet-speech-hint')
    if (!hint) return
    const time = lastSpeech.at ? new Date(lastSpeech.at).toLocaleTimeString('zh-CN', { hour12: false }) : ''
    const parts = []
    parts.push(cfg.ttsEnabled ? '扬声器开' : '🔇 已静音，实际回答不会念')
    parts.push('引擎：' + (cfg.engine === 'custom' ? '自定义 TTS' : cfg.engine === 'sapi' ? 'Windows' : '浏览器'))
    parts.push(lastSpeech.at ? '最近朗读 ' + time + '，' + lastSpeech.chars + ' 字' : '还没朗读过')
    if (lastSpeech.state) parts.push(lastSpeech.state)
    if (extra) parts.push(extra)
    hint.textContent = '朗读状态：' + parts.join('｜')
  }

  function speak(text) {
    if (!text) return
    if (!cfg.ttsEnabled) {
      lastSpeech.state = '刚才那条被静音吞了'
      updateSpeechHint()
      say('静音中，这条不念。点 🔊 开嗓。', 3500)
      return
    }
    if (cfg.engine === 'browser') { speakBrowser(text); return }
    feedSpeech('speak-' + Date.now(), text, true)
  }

  // 停嘴：清掉排队等着合成的句子，别念到一半又冒出下一句
  function stopSpeak() {
    ttsSeq++
    speechQueue.length = 0
    try { if (window.speechSynthesis) window.speechSynthesis.cancel() } catch (e) {}
    if (audioEl) { try { audioEl.pause() } catch (e) {} ; audioEl = null }
    if (fishEl) fishEl.classList.remove('speaking')
    // 把正卡在「等这段播完」的流水线叫醒，否则它会一直等到 90 秒看门狗
    const fin = currentPlayFinish
    currentPlayFinish = null
    if (fin) { try { fin() } catch (e) {} }
  }

  // ⏹ 停止「这一条」回答的朗读：记住停在哪，这条不再续念；下一条新回答照常出声
  function stopAnswerSpeech() {
    const nodes = answerNodes()
    const el = nodes[nodes.length - 1]
    let key = ''
    if (el) {
      key = nodeKey(el) || 'last'
      const t = stripForSpeech(answerText(el)).slice(0, 1400)
      if (t) stoppedKeys.set(key, t)
      else stoppedKeys.set(key, '')
    } else {
      key = 'last'
      stoppedKeys.set(key, '')
    }
    stopSpeak()
    lastSpeech = { at: Date.now(), chars: 0, state: '已停止本次朗读（下一条照样念）' }
    updateSpeechHint()
    logSpeech('按了停止，这条不再念（key=' + String(key).slice(0, 24) + '）')
    say('好，这条不念了。', 2400)
  }

  // 让语音服务先把模型读进显存：不然第一条要等 10 秒冷启动
  let warmedUp = false
  // 浏览器引擎在 Electron 里常常一个中文音色都没有，选它就是「静音」——开机自检一次，替用户改回来
  function guardEngine() {
    if (cfg.engine !== 'browser') return
    const hasZhVoice = () => {
      try {
        const list = (window.speechSynthesis && window.speechSynthesis.getVoices()) || []
        return list.some((v) => /^zh/i.test(v.lang || ''))
      } catch (e) { return false }
    }
    const check = () => {
      if (hasZhVoice()) { logSpeech('浏览器引擎：找到中文音色'); return }
      cfg.engine = 'sapi'
      saveCfg()
      if (engineSel) engineSel.value = 'sapi'
      logSpeech('浏览器引擎没有中文音色 → 自动改用 Windows 语音')
      say('浏览器这头没有中文音色，本鱼把朗读引擎换成 Windows 语音了。', 7000)
    }
    setTimeout(check, 1200)
  }

  function warmUpTts() {
    if (warmedUp || cfg.engine !== 'custom' || !cfg.customEndpoint) return
    warmedUp = true
    setTimeout(async () => {
      try {
        const resp = await fetch(TTS_CUSTOM_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(customPayload('嗯')),
        })
        if (!resp.ok) {
          const detail = await resp.text().catch(() => '')
          logSpeech('端点自检失败 HTTP ' + resp.status + ' ' + String(detail).slice(0, 60))
          return
        }
        const blob = await resp.blob()
        logSpeech('端点自检 OK，' + Math.round(blob.size / 1024) + 'KB（已暖机）')
      } catch (err) {
        logSpeech('端点自检连不上：' + String((err && err.message) || err).slice(0, 60))
      }
    }, 2500)
  }

  // 模型还在下载时，隔几秒看看进度，下好了喊一声
  let prepareWatcher = null

  // ⚙ 面板里显示识别引擎现状
  async function refreshAsrHint() {
    const hint = root && root.querySelector('#dshpet-asr-hint')
    if (!hint) return
    try {
      const resp = await fetch(ASR_STATUS_URL, { cache: 'no-store' })
      const data = await resp.json().catch(() => ({}))
      const phase = data && data.phase
      const pct = data && typeof data.percent === 'number' ? ' ' + data.percent + '%' : ''
      if (data && data.engine === 'sensevoice') {
        if (phase === 'ready' || phase === 'standby') hint.textContent = '识别引擎：SenseVoice 本机模型（准确率高）'
        else if (phase === 'downloading') hint.textContent = '识别引擎：模型下载中' + pct
        else if (phase === 'failed') hint.textContent = '识别引擎：模型下载失败，暂时用 SAPI'
        else hint.textContent = '识别引擎：SenseVoice 未就绪（' + (phase || '未知') + '），点上面按钮下载模型'
      } else {
        hint.textContent = '识别引擎：Windows SAPI（准确率一般，想变准就装官方语音包）'
      }
    } catch (e) {}
  }
  function watchPrepare(initialPercent) {
    if (prepareWatcher) return
    let tries = 0
    let lastPct = typeof initialPercent === 'number' ? initialPercent : null
    prepareWatcher = setInterval(async () => {
      tries++
      try {
        const resp = await fetch(ASR_STATUS_URL, { cache: 'no-store' })
        const data = await resp.json().catch(() => ({}))
        if (data && (data.phase === 'ready' || data.phase === 'standby')) {
          clearInterval(prepareWatcher); prepareWatcher = null
          say('语音模型下好了！以后识别会准很多，再说一句试试～', 6000)
          return
        }
        if (data && data.phase === 'failed') {
          clearInterval(prepareWatcher); prepareWatcher = null
          say('模型下载失败了……暂时继续用 SAPI 顶着。', 6000)
          return
        }
        const pct = data && typeof data.percent === 'number' ? data.percent : null
        if (pct !== null && pct !== lastPct) {
          lastPct = pct
          say('本鱼在下载语音模型 ' + pct + '%（约 240MB，只下一次）', 4000)
        }
      } catch (e) {}
      if (tries > 400) { clearInterval(prepareWatcher); prepareWatcher = null }
    }, 3000)
  }

  // ---------- 启动 ----------
  function boot() {
    // 任何没被接住的异常都写进 ⚙ 的朗读日志，不用开 DevTools 也能看见
    try {
      window.addEventListener('error', (ev) => {
        const msg = ev && (ev.message || (ev.error && ev.error.message))
        if (msg) logSpeech('JS 错误：' + String(msg).slice(0, 80))
      })
      window.addEventListener('unhandledrejection', (ev) => {
        const r = ev && ev.reason
        const msg = r && (r.message || r)
        if (msg) logSpeech('未处理错误：' + String(msg).slice(0, 80))
      })
    } catch (e) {}
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', boot, { once: true })
      return
    }
    if (document.getElementById(SCRIPT_TAG_ID)) return
    injectCss()
    buildUi()
    armGlobalWatch()
    warmUpTts()
    guardEngine()
    if (window.speechSynthesis) {
      try { window.speechSynthesis.getVoices() } catch (e) {}
      window.speechSynthesis.onvoiceschanged = () => {}
    }
    LOG('mounted')
  }

  boot()
})()
