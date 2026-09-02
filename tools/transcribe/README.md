# 本地语音转写（可选）

把面试录音或 MP4 转成带时间戳的文本，供「复盘 → 真实面试复盘」使用。

**引擎在仓库外部**：sherpa-onnx 装在这个目录下的独立 venv 里，Node 侧只用
`child_process` 调 `transcribe.py`。主项目保持零 npm 依赖这条红线不变。

**只在本地可用**。Vercel 无状态、请求体 4.5MB 上限、也跑不了 Python，线上
`/api/health` 的 `transcribeEnabled` 恒为 `false`，前端禁用本地上传入口，并保留
「粘贴/上传转写文本」。不配置这套东西，复盘功能的其余部分照样能用。

## 一次性安装

### 1. ffmpeg

录音基本都是 m4a，sherpa-onnx 只吃 wav，中间必须过一道 ffmpeg。

```powershell
winget install --id Gyan.FFmpeg -e
# 装完新开一个终端，确认 PATH 生效
ffmpeg -version
```

### 2. Python venv

```powershell
cd <仓库根目录>
python -m venv tools\transcribe\.venv
tools\transcribe\.venv\Scripts\python.exe -m pip install sherpa-onnx numpy
```

Windows / CPython 3.12 有预编译 wheel（实测 sherpa-onnx 1.13.7），不需要编译工具链。

### 3. 模型

下到 `tools/transcribe/models/`，这个目录已在 `.gitignore` 里。

```powershell
$dir = "tools\transcribe\models"
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx" -OutFile "$dir\silero_vad.onnx"
Invoke-WebRequest "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2" -OutFile "$dir\sensevoice.tar.bz2"
tar -xjf "$dir\sensevoice.tar.bz2" -C $dir
# 只要这两个文件，解压出来的其余内容可以删
Move-Item "$dir\sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17\model.int8.onnx" $dir -Force
Move-Item "$dir\sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17\tokens.txt" $dir -Force
```

装完 `models/` 里应该有三个文件：

```
models/model.int8.onnx     ~230MB
models/tokens.txt          ~300KB
models/silero_vad.onnx     ~2MB
```

### 4. 环境变量

在仓库根目录的 `.env` 里加（路径写绝对路径，Node 会 `existsSync` 逐个检查）：

```
ASR_PYTHON=C:\...\job-hunter\tools\transcribe\.venv\Scripts\python.exe
ASR_SCRIPT=C:\...\job-hunter\tools\transcribe\transcribe.py
ASR_MODEL_DIR=C:\...\job-hunter\tools\transcribe\models
ASR_MAX_UPLOAD_MB=1024
```

三项路径任意一项缺失或不存在，`isTranscribeEnabled()` 就返回 `false`，页面上的
录音入口自动消失——不会报错，只是没有那个按钮。

## 单独跑一次（排查用）

```powershell
tools\transcribe\.venv\Scripts\python.exe tools\transcribe\transcribe.py `
  --audio "C:\path\to\录音.m4a" `
  --model-dir tools\transcribe\models
```

stdout 是按行 JSON：`{"progress":0.42}` 若干行，最后一行
`{"segments":[{"start":12.3,"end":18.1,"text":"..."}],"durationSec":3600}`。
出错时输出 `{"error":"..."}` 并以非 0 退出。

## 已知边界

- **没有说话人分离**。sherpa-onnx 不提供这个能力。角色（面试官 / 我）由
  `src/services/review.js` 的 `guessRoles` 用确定性规则预标，前端每段都有一个
  切换按钮让你改。这是「够用 + 可纠正」的取舍，不是 bug。
- 纯 CPU 推理，速度取决于核数。首次运行要额外几秒加载模型。实测耗时记在下面，
  用来校准前端的进度提示文案。
- 转写完成或失败后，Node 立刻删掉临时录音文件；服务端不保存任何录音。
- 转写文本不写日志。排查问题时只能看到错误码和进度，看不到面试内容。

### 实测耗时

| 录音时长 | 机器 | 耗时 | 备注 |
|---|---|---|---|
| 5.6 秒 | 16 逻辑核笔记本，8 线程 | 1.9 秒 | 模型自带 `test_wavs/zh.wav`，大部分是模型加载 |
| 5 分 00 秒 | 同上 | 7.9 秒 | 干净语音循环拼接成 m4a，54 个分段，约 38 倍实时 |

推算一小时录音大致 2–5 分钟。上面两行用的都是干净录制的样本，真实面试录音有底噪、
串话和长段连续说话（VAD 会切出接近 30 秒上限的大段），会比这个数字慢，但不会掉一个量级。
拿到第一段真实面试录音后补一行到表里。
