"""把 client.js 里的 SVG 大鱼换成用户给的立绘（内嵌 data URI），并加上「停止本次朗读」按钮的骨架。
只做文本替换，不碰流水线逻辑。"""
import re, sys

P = 'client.js'
s = open(P, encoding='utf-8').read()

# 1) SVG → data URI 常量
start = s.index('  // ---------- 大肥鱼 SVG ----------')
end = s.index('</svg>`', start) + len('</svg>`')
s = s[:start] + """  // ---------- 形象：用户给的立绘（已去背景，PNG 200px 宽内嵌成 data URI，免服务器路由） ----------
  const PET_IMG = 'data:image/png;base64,__PET_B64__'""" + s[end:]

# 2) 样式：容器不再写死 86x86
s = s.replace("""  .dshpet-fish{width:86px;height:86px;cursor:grab;filter:drop-shadow(0 6px 14px rgba(0,0,0,.35));
    transition:transform .15s}""",
"""  .dshpet-fish{cursor:grab;filter:drop-shadow(0 6px 10px rgba(0,0,0,.42));transition:transform .15s;
    display:flex;align-items:flex-end}
  .dshpet-avatar{height:112px;width:auto;display:block;pointer-events:none;
    -webkit-user-drag:none;user-select:none}""")

# 3) markup：塞 img + 停止按钮
s = s.replace('>${FISH_SVG}</div>', '><img class="dshpet-avatar" src="${PET_IMG}" alt="" draggable="false"></div>')
s = s.replace("""          <button class="dshpet-btn" id="dshpet-gear" title="音色与语速">⚙</button>""",
"""          <button class="dshpet-btn" id="dshpet-stop" title="停止这次朗读（不影响下一条）">⏹</button>
          <button class="dshpet-btn" id="dshpet-gear" title="音色与语速">⚙</button>""")

open(P, 'w', encoding='utf-8').write(s)
print('patched markup/css/img; FISH_SVG left =', s.count('FISH_SVG'), 'PET_IMG =', s.count('PET_IMG'))
