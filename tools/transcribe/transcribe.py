#!/usr/bin/env python
"""本地语音转写：录音 → 带时间戳的分段文本。

被 Node 侧 src/services/transcribe.js 用 child_process spawn 调用，
按行往 stdout 输出 JSON：

    {"progress": 0.42}          # 逐行更新进度
    {"segments": [...], "durationSec": 3600}   # 最后一行是结果

引擎是 sherpa-onnx（SenseVoice int8 + silero VAD），纯 CPU，不需要 GPU。
没有说话人分离能力——角色靠 Node 侧的规则预标 + 用户在页面上一键纠正。

依赖：sherpa-onnx、numpy（装在 tools/transcribe/.venv 里）、外部 ffmpeg。
"""
import argparse
import json
import os
import subprocess
import sys

# Windows 下 Python 向管道写字默认用 locale 编码（中文系统是 cp936），而 Node 那边是按 utf8 读的。
# 不显式固定成 utf-8 的话，中文转写结果到了 Node 里全是替换字符，日韩文还会直接抛
# UnicodeEncodeError 把整个任务带挂。这一段必须在任何输出之前。
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

SAMPLE_RATE = 16000
# VAD 单个语音块的上限。面试里一个人连着说两分钟很常见，切太碎反而难读。
MAX_SEGMENT_SEC = 30.0


def emit(payload):
    """一行一个 JSON。必须立刻 flush，否则进度会攒在管道缓冲里，前端进度条一直是 0。"""
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def die(message):
    emit({"error": message})
    sys.exit(1)


def decode_to_pcm(audio_path):
    """用 ffmpeg 统一转成 16k 单声道 16bit PCM。

    m4a/mp3/aac 这些容器 sherpa-onnx 读不了，只能读 wav；而面试录音基本都是 m4a。
    走 ffmpeg 而不是引入 Python 解码库，是为了不给这个工具再堆依赖。
    """
    command = [
        "ffmpeg", "-nostdin", "-loglevel", "error", "-i", audio_path,
        "-f", "s16le", "-acodec", "pcm_s16le", "-ac", "1", "-ar", str(SAMPLE_RATE), "-",
    ]
    try:
        result = subprocess.run(command, capture_output=True, check=False)
    except FileNotFoundError:
        die("找不到 ffmpeg，请先安装并加入 PATH（winget install --id Gyan.FFmpeg -e）")
    if result.returncode != 0:
        tail = (result.stderr or b"").decode("utf8", "replace").strip().splitlines()
        die("ffmpeg 解码失败：" + (tail[-1] if tail else f"退出码 {result.returncode}"))
    if not result.stdout:
        die("ffmpeg 没有输出音频数据，文件可能损坏或不含音轨")
    return result.stdout


def to_float32(pcm_bytes):
    import numpy as np

    # int16 → [-1, 1] float32，sherpa-onnx 的输入约定
    return np.frombuffer(pcm_bytes, dtype=np.int16).astype("float32") / 32768.0


def build_recognizer(model_dir, threads):
    import sherpa_onnx

    model = os.path.join(model_dir, "model.int8.onnx")
    tokens = os.path.join(model_dir, "tokens.txt")
    for path in (model, tokens):
        if not os.path.exists(path):
            die(f"模型文件缺失：{path}（见 tools/transcribe/README.md 的下载步骤）")

    return sherpa_onnx.OfflineRecognizer.from_sense_voice(
        model=model,
        tokens=tokens,
        num_threads=threads,
        use_itn=True,  # 数字/日期转成阿拉伯数字，逐字记录才读得下去
        debug=False,
    )


def build_vad(model_dir, threads):
    import sherpa_onnx

    vad_model = os.path.join(model_dir, "silero_vad.onnx")
    if not os.path.exists(vad_model):
        die(f"VAD 模型缺失：{vad_model}（见 tools/transcribe/README.md 的下载步骤）")

    config = sherpa_onnx.VadModelConfig()
    config.silero_vad.model = vad_model
    config.silero_vad.threshold = 0.5
    config.silero_vad.min_silence_duration = 0.5
    config.silero_vad.min_speech_duration = 0.25
    config.silero_vad.max_speech_duration = MAX_SEGMENT_SEC
    config.sample_rate = SAMPLE_RATE
    config.num_threads = threads
    return sherpa_onnx.VoiceActivityDetector(config, buffer_size_in_seconds=100)


def recognize(recognizer, samples):
    stream = recognizer.create_stream()
    stream.accept_waveform(SAMPLE_RATE, samples)
    recognizer.decode_stream(stream)
    return stream.result.text.strip()


def main():
    parser = argparse.ArgumentParser(description="本地语音转写（sherpa-onnx + SenseVoice）")
    parser.add_argument("--audio", required=True, help="音频文件路径，任意 ffmpeg 支持的格式")
    parser.add_argument("--model-dir", required=True, help="模型目录，含 model.int8.onnx / tokens.txt / silero_vad.onnx")
    parser.add_argument("--threads", type=int, default=max(2, (os.cpu_count() or 4) // 2))
    args = parser.parse_args()

    if not os.path.exists(args.audio):
        die(f"音频文件不存在：{args.audio}")

    emit({"progress": 0.01})
    samples = to_float32(decode_to_pcm(args.audio))
    total = len(samples)
    duration_sec = total / SAMPLE_RATE
    if total == 0:
        die("音频没有有效采样")

    emit({"progress": 0.05})
    recognizer = build_recognizer(args.model_dir, args.threads)
    vad = build_vad(args.model_dir, args.threads)

    segments = []
    window = 512  # silero_vad 的固定帧长，传别的长度会报错
    offset = 0
    last_reported = 0.05

    def drain():
        while not vad.empty():
            speech = vad.front
            # front 返回的是内部队列里的引用，pop 之后 samples 就变成空的，必须先拷出来
            chunk = speech.samples.copy()
            start = speech.start / SAMPLE_RATE
            vad.pop()
            text = recognize(recognizer, chunk)
            if not text:
                continue
            segments.append({
                "start": round(start, 2),
                "end": round(start + len(chunk) / SAMPLE_RATE, 2),
                "text": text,
            })

    while offset < total:
        vad.accept_waveform(samples[offset:offset + window])
        offset += window
        drain()
        # 0.05~0.98 区间留给进度，剩下的给收尾。转写文本一律不进 stdout 之外的地方。
        progress = 0.05 + 0.93 * (offset / total)
        if progress - last_reported >= 0.01:
            last_reported = progress
            emit({"progress": round(progress, 3)})

    vad.flush()
    drain()

    emit({"segments": segments, "durationSec": round(duration_sec, 2)})


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as error:  # noqa: BLE001 —— 任何异常都要变成 Node 能读的一行 JSON
        die(f"{type(error).__name__}: {error}")
