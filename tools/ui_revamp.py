"""UI 改版：面板横向布局 + 去掉测试朗读/朗读日志（文件是 CRLF，先归一化再写回）。"""
import io

P = 'client.js'
raw = io.open(P, encoding='utf-8', newline='').read()
s = raw.replace('\r\n', '\n')
orig = s

# 1) logSpeech 不再往 DOM 写字（日志面板已移除）
old_log = """    const box = root && root.querySelector('#dshpet-speech-log')
    if (box) box.textContent = '朗读日志：\\n' + speechLog.slice(-6).join('\\n')
"""
assert old_log in s, 'logSpeech DOM block not found'
s = s.replace(old_log, '')

# 2) 删掉 .dshpet-speech-log 样式
old_css = "  .dshpet-speech-log{opacity:.72;font-size:10px;line-height:1.4;white-space:pre-wrap;word-break:break-all;max-height:88px;overflow:auto;background:rgba(0,0,0,.22);border:1px solid rgba(255,255,255,.12);border-radius:6px;padding:5px 6px;font-family:ui-monospace,Consolas,monospace}\n"
assert old_css in s, 'speech-log css not found'
s = s.replace(old_css, '')

# 3) 面板改成横向网格（窄屏自动落回一列）
old_panel = """  .dshpet-panel{background:rgba(20,24,30,.96);border:1px solid rgba(120,190,255,.3);border-radius:12px;
    padding:9px 10px;font-size:11px;color:#cfe6ff;display:flex;flex-direction:column;gap:7px;width:210px;
    box-shadow:0 8px 24px rgba(0,0,0,.42)}"""
new_panel = """  .dshpet-panel{background:rgba(20,24,30,.96);border:1px solid rgba(120,190,255,.3);border-radius:12px;
    padding:10px 12px;font-size:11px;color:#cfe6ff;display:grid;gap:8px 14px;align-items:start;
    grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
    width:min(560px,calc(100vw - 48px));max-height:min(66vh,520px);overflow:auto;
    box-shadow:0 8px 24px rgba(0,0,0,.42)}
  .dshpet-panel > .dshpet-panel-row,.dshpet-panel > .dshpet-hint,.dshpet-panel > #dshpet-custom{grid-column:1/-1}
  .dshpet-panel > #dshpet-custom{display:grid;gap:8px 14px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
  .dshpet-panel > #dshpet-custom[hidden]{display:none}"""
assert old_panel in s, 'panel css not found'
s = s.replace(old_panel, new_panel)

io.open(P, 'w', encoding='utf-8', newline='').write(s.replace('\n', '\r\n'))
print('changed:', s != orig)
print('speech-log refs:', [i + 1 for i, l in enumerate(s.splitlines()) if 'speech-log' in l])
print('test-speak refs:', [i + 1 for i, l in enumerate(s.splitlines()) if 'test-speak' in l])
