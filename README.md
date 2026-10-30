# 大肥鱼语音交互-声音可自配！ · dsh-pet-voice

给 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）装的桌面宠物插件：屏幕右下角蹲着一只小宠物，**点一下就能说话**——说的话自动识别成文字填进对话框并发出去，助手回答完再用语音念给你听。

没有麦也能用：打字提问同样会朗读。

```
说话 → 识别（SenseVoice / Windows SAPI）→ 填进输入框 → 自动发送
                                                        ↓
                                   只念助手的「回答」正文 ← 朗读（Windows / 浏览器 / 自定义 TTS）
```

## 特性

| 功能 | 说明 |
| --- | --- |
| 🎤 语音输入 | 点宠物或麦克风按钮开录，停顿 1.4 秒自动结束；优先用 DSH 内置的 SenseVoice 本地模型（239 MB，一次下载离线可用），没装好时自动退回 Windows 自带识别引擎 |
| 🔊 只念回答 | 从聊天流节点里只取助手的正文，推理过程、时间戳、代码块、"已复制"这类按钮文字都不念 |
| ⚡ 句子级流水线 | 不等整段合成完：按句切分，播第一句时第二句已在合成。首句出声约 0.9–2 秒（整段合成要 7–10 秒） |
| ⏹ 随时闭嘴 | 点一下立刻掐掉本次朗读，**不影响下一条回答** |
| 🎚 三种朗读引擎 | Windows SAPI（离线、音色可选、音调可调）/ 浏览器语音 / 自定义 TTS 服务（GPT-SoVITS、CosyVoice、任何返回音频的 POST 接口） |
| ⚙ 设置面板 | 横排网格布局；引擎、音色、语速、音调、试听、识别模型进度、朗读状态、链路体检 |
| 📦 一键装 GPT-SoVITS | 面板里「装 GPT-SoVITS」：自动从国内镜像下整合包（约 8 GB，解压后 14 GB）→ 解压 → 写启动脚本 → 起 `api_v2.py`，装好自动把引擎接过去 |
| 🖱 可拖动 | 宠物位置记在 localStorage，下次打开还在原地 |

三种朗读引擎的回退顺序是 **自定义 → Windows SAPI → 浏览器**：前一个没声音就自动换下一个，并且**绝不**把降级结果写回配置（否则一次网络抖动就会让你永久没声音）。

## 安装

前提：你有一份能跑的 DSH 桌面版或 Web 版，并且能打开它的插件管理（`plugin_manager` 工具或设置里的插件页）。

### 方式 A：从 GitHub 源码装（推荐）

```bash
git clone https://github.com/777Fern777/dsh-pet-voice.git
```
或者直接在DSH 添加插件 https://github.com/777Fern777/dsh-pet-voice.git


然后让 DSH 装上它（二选一）：

- **插件管理工具**：`plugin_manager install_bundle target=link:<克隆下来的绝对路径>`
- **手工**：编辑你的 profile（例如 `~/.dsh/profiles/desktop/package.json`）
  - `dependencies` 里加 `"@pet-fish/dsh-pet-voice": "link:<克隆下来的绝对路径>"`
  - `dsh.profile.bundles` 数组末尾加 `"@pet-fish/dsh-pet-voice"`

装完**重启一次 DSH**（首次安装要重启；之后改 `client.js` 只要刷新页面）。

### 方式 B：压缩包

下载 Release 里的 `.zip`，解压到任意目录，按方式 A 的第二步做 `link:` 安装。

### 方式 C：npm

```bash
npm i @pet-fish/dsh-pet-voice
```

> 这个包目前没有发布到 npm registry，`@pet-fish` 作用域只是本地占位。要走 npm 分发请先自己 `npm publish`，并把 `package.json` 里的 `repository` 填成你的仓库。

## 用法

1. 装好后刷新页面，右下角出现小宠物和五个按钮

   | 按钮 | 作用 |
   | --- | --- |
   | 🎤 | 开始 / 结束说话 |
   | 🔊 | 静音开关 |
   | ⏎ | 「说完自动发送」开关（关掉后只把文字填进输入框） |
   | ⏹ | 停止本次朗读，不影响下一条 |
   | ⚙ | 设置面板 |

2. 点 🎤 → 说话 → 停一下，文字自己进输入框并发出去
3. ⚙ 面板可以**按住标题行拖到任意位置**（双击标题行归位），位置记在 localStorage

### 让语音服务一直在

⚙ 面板里两个开关：

- **随 DSH 自动拉起**（默认开）：DSH 启动 6 秒后探测 `127.0.0.1:9880`，没响应就用 WMI 派生进程把它拉起来，关掉 DSH 也不会被回收
- **开机自启（登录 Windows 时）**：在「启动」文件夹写一个 `dsh-pet-gpt.vbs`，登录后静默（无窗口）起服务；关掉开关就把它删掉

「GPT-SoVITS 目录」填你已经装好的路径（例如 `D:/GPT-SoVITS-v2pro-20261006`），回车确认——**不用重下那 8 GB**。
3. 助手回答完会自动念出来；想打断就按 ⏹

### 换个音色

- **最省事**：⚙ 里点「装 GPT-SoVITS」（第一次点只是确认，30 秒内再点一次才开始下），它会
  1. 依次从魔搭 / hf-mirror / HuggingFace 下整合包（默认装到 `~/GPT-SoVITS`，可用环境变量 `DSH_PET_GPT_DIR` 改）
  2. 用自带的 `7zr.exe` 解压（没有就自动下 600 KB 的 7zr）
  3. 写好 `start-tts-api.bat`，用 WMI 派生进程起服务（关掉 DSH 也不会被一并回收）
  4. 探测到 9880 有响应就把朗读引擎切过去
- **Windows 自带**：`设置 → 时间和语言 → 语音` 里装中文语音包（例如 Huihui），装完点 ⚙ 会自动读到新音色；音调可调 −30%～+30%
- **自定义 TTS（能克隆音色）**：⚙ 里引擎选「自定义」，填服务地址。以 [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) 为例：
  1. 用 `api_v2.py` 起服务（默认 `http://127.0.0.1:9880/tts`）
  2. ⚙ → 自定义 TTS 地址填 `http://127.0.0.1:9880/tts`
  3. 「参考音频路径」填一段 3–10 秒的干声 wav 绝对路径，「参考文字」填这段音频里**一模一样的原话**
  4. 点试听

  参考音频路径留空时，插件按 OpenAI 兼容格式发请求（`{"model","input","voice","response_format"}`），可以接 SiliconFlow / OpenAI / 任何自建兼容服务。请求体想自己拼就在「请求体模板」里写，支持 `{{text}}` `{{model}}` `{{voice}}` `{{refAudio}}` `{{promptText}}` 占位。

## 识别引擎

插件在宿主侧注册了 `POST /dsh-pet/asr`：

1. 先问 DSH 官方 `speechToText` 服务有没有就绪的本地模型（SenseVoice，支持 auto/zh/en/ja/ko/yue）
2. 没有就**后台开始下载**，同时这一句先用 Windows SAPI 顶着（面板里能看到下载百分比）
3. 模型到位后自动切过去，准确率明显更高

首次下载约 239 MB，只下一次。国内网络会自动走 `hf-mirror.com` 镜像。

## 已知限制

- **只在 Windows 上完整可用**：语音识别和 SAPI 朗读都调 `powershell.exe` + `System.Speech`。Linux / macOS 上能显示宠物、能调自定义 TTS，但没有本地识别。
- 浏览器直连的网页版（非 Electron）里，建议把 `localhost` 换成 DSH 打印的真实地址，否则麦克风权限会被拒。
- 录音走浏览器 `getUserMedia`，因此 DSH 必须运行在 localhost 或 https 下。
- 连续说话的间隔请留一点；VAD 判定「静音 1.4 秒」为一句结束。

## 开发

```bash
node test/selfcheck.mjs        # 用假的 cordis ctx 跑一遍 apply()：路由数、注入行、幂等
node test/syn.mjs              # client.js 语法 + 关键符号
node test/routes.mjs           # 列出声明的 HTTP 路由
node test/pipeline-sim.mjs     # 假 DOM 跑句子流水线，验证不重不漏、句句都播
node test/tts-check.mjs        # 列 Windows 音色 + 合成三段试听 wav
node test/tts-custom-check.mjs # 起假 TTS 服务，验证代理转发与模板替换
node test/gpt-install-check.mjs # 自造假整合包，演练 下载→解压→定位→写启动脚本（不联网）
node test/autostart-check.mjs  # 开机自启的 vbs 写入/删除
```

结构：

```
index.js          宿主插件（{name, apply}）：静态路由 + index 注入 + ASR/TTS 代理
client.js         浏览器脚本（纯 IIFE，<script src> 直接加载）：UI、录音、流水线、朗读
gpt-installer.js  GPT-SoVITS 一键安装（下载 / 7zr 解压 / WMI 派生启动 / 自启动）
cordis.patch.yml  bundle 声明（id: pet-voice）
assets/           形象图片；tools/ 抠图脚本
```

## License

MIT。`assets/src.png` 是使用者提供的角色立绘，随代码一起分发；如果你要商用或再分发，请自行确认版权归属。
