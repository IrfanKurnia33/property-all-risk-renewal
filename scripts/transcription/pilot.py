"""Benchmark three short, fixed excerpts; all speech recognition runs locally."""
import argparse
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import time
import wave

ROOT = Path(__file__).resolve().parents[2]
VIDEO = ROOT / 'docs/research/post-prototype-research-plan/conversation-with-falih.mp4'
TOOLS = ROOT / '.tools/transcription'
ENGINE = TOOLS / 'whisper-v1.8.3-cuda11/Release/whisper-cli.exe'
MODEL = TOOLS / 'models/ggml-large-v3-turbo-q5_0.bin'
WORK = ROOT / '.cache/transcription-pilot'
SAMPLES = (('early', 300, 120), ('middle', 2880, 120), ('late', 5400, 120))


def timestamp(seconds):
    total_ms = round(seconds * 1000)
    hours, rest = divmod(total_ms, 3_600_000)
    minutes, rest = divmod(rest, 60_000)
    second, milliseconds = divmod(rest, 1000)
    return f'{hours:02}:{minutes:02}:{second:02},{milliseconds:03}'


def absolute_segment(segment, offset):
    start = offset + segment['offsets']['from'] / 1000
    end = offset + segment['offsets']['to'] / 1000
    assert 0 <= start <= end
    return {'start': start, 'end': end, 'text': segment['text'].strip()}


def run(command, **kwargs):
    result = subprocess.run(list(map(str, command)), capture_output=True, text=True, encoding='utf-8', errors='replace', **kwargs)
    if result.returncode:
        raise RuntimeError(f'Process exited {result.returncode}:\n{result.stderr[-6000:]}\n{result.stdout[-2000:]}')
    return result


def extract():
    WORK.mkdir(parents=True, exist_ok=True)
    candidates = list((ROOT / '.tools/walkthrough/.venv/Lib/site-packages/imageio_ffmpeg/binaries').glob('ffmpeg*.exe'))
    assert len(candidates) == 1, 'Expected the repository-local FFmpeg used for the walkthrough.'
    ffmpeg = candidates[0]
    probe = run([ffmpeg, '-hide_banner', '-i', VIDEO, '-t', '0', '-f', 'null', '-'])
    match = re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)', probe.stderr)
    assert match, 'Could not read video duration.'
    h, m, s = map(float, match.groups())
    duration = h * 3600 + m * 60 + s
    extracted = []
    for name, offset, length in SAMPLES:
        assert offset >= 0 and offset + length <= duration
        wav = WORK / f'{name}.wav'
        started = time.perf_counter()
        run([ffmpeg, '-hide_banner', '-y', '-ss', offset, '-i', VIDEO, '-t', length,
             '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav])
        with wave.open(str(wav), 'rb') as audio:
            assert audio.getframerate() == 16000 and audio.getnchannels() == 1
            seconds = audio.getnframes() / audio.getframerate()
            assert abs(seconds - length) < 0.05
        extraction_s = time.perf_counter() - started
        volume = run([ffmpeg, '-hide_banner', '-i', wav, '-af', 'volumedetect', '-f', 'null', '-']).stderr
        run([ffmpeg, '-hide_banner', '-y', '-ss', offset + length / 2, '-i', VIDEO,
             '-frames:v', '1', WORK / f'{name}-midpoint.jpg'])
        extracted.append({'name': name, 'offsetSeconds': offset, 'durationSeconds': seconds,
                          'extractionSeconds': extraction_s,
                          'volume': [line.strip() for line in volume.splitlines() if 'volume:' in line]})
        print(f'Extracted {name}: {timestamp(offset)} to {timestamp(offset+length)} in {extraction_s:.2f}s', flush=True)
    report = {'source': str(VIDEO.relative_to(ROOT)), 'sourceBytes': VIDEO.stat().st_size,
              'sourceDurationSeconds': duration, 'python': sys.version,
              'platform': platform.platform(), 'logicalCPUs': os.cpu_count(),
              'model': str(MODEL.relative_to(ROOT)), 'engine': str(ENGINE.relative_to(ROOT)),
              'language': 'id', 'samples': extracted}
    (WORK / 'extraction.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    return report


def transcribe(report, cpu=False):
    assert ENGINE.exists() and MODEL.stat().st_size > 500_000_000
    env = os.environ.copy()
    cuda_bin = TOOLS / 'cuda11/nvidia/cublas/bin'
    env['PATH'] = str(cuda_bin) + os.pathsep + env.get('PATH', '')
    # The child process is offline. Model/software downloads are a separate setup step.
    env['HF_HUB_OFFLINE'] = '1'
    report['requestedDevice'] = 'cpu' if cpu else 'cuda'
    report['threads'] = 4
    report['beamSize'] = 5
    results = []
    for sample in report['samples']:
        name = sample['name']
        prefix = WORK / f'{name}-turbo'
        command = [ENGINE, '-m', MODEL, '-f', WORK / f'{name}.wav', '-l', 'id',
                   '-t', '4', '-bs', '5', '-bo', '5', '-ojf', '-osrt', '-otxt', '-of', prefix]
        if cpu:
            command.append('-ng')
        print(f'Transcribing {name} locally...', flush=True)
        started = time.perf_counter()
        result = run(command, env=env, cwd=ENGINE.parent)
        elapsed = time.perf_counter() - started
        (WORK / f'{name}-engine.log').write_text(result.stderr + '\n' + result.stdout, encoding='utf-8')
        decoded = json.loads(prefix.with_suffix('.json').read_text(encoding='utf-8'))
        segments = [absolute_segment(segment, sample['offsetSeconds']) for segment in decoded['transcription'] if segment['text'].strip()]
        assert segments, 'The sample produced no transcript.'
        assert all(sample['offsetSeconds'] <= item['start'] <= item['end'] <= sample['offsetSeconds'] + sample['durationSeconds'] + 0.1 for item in segments)
        transcript = ['# Local transcription sample — unverified ASR', '',
                      f'Source interval: {timestamp(sample["offsetSeconds"])}–{timestamp(sample["offsetSeconds"] + sample["durationSeconds"])}.',
                      'Timestamps refer to the full recording. Speaker attribution has not been established.', '']
        for segment in segments:
            transcript.extend([f'[{timestamp(segment["start"])}–{timestamp(segment["end"])}] {segment["text"]}', ''])
        (WORK / f'{name}-source-transcript.md').write_text('\n'.join(transcript), encoding='utf-8')
        (WORK / f'{name}-source.srt').write_text('\n\n'.join(f'{index}\n{timestamp(segment["start"])} --> {timestamp(segment["end"])}\n{segment["text"]}' for index, segment in enumerate(segments, 1))+'\n', encoding='utf-8')
        load = re.search(r'load time\s*=\s*([\d.]+) ms', result.stderr)
        entry = {**sample, 'transcriptionWallSeconds': elapsed,
                 'audioSecondsPerWallSecond': sample['durationSeconds'] / elapsed,
                 'modelLoadSeconds': float(load.group(1)) / 1000 if load else None,
                 'segments': segments,
                 'backendLog': [line.strip() for line in result.stderr.splitlines() if any(key in line for key in ('CUDA', 'use_gpu', 'GPU', 'total time', 'load time', 'devices'))]}
        results.append(entry)
        report['results'] = results
        (WORK / 'benchmark.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f'Completed {name}: {elapsed:.2f}s for {sample["durationSeconds"]:.0f}s audio ({sample["durationSeconds"]/elapsed:.2f}x real time)', flush=True)
    total_audio = sum(item['durationSeconds'] for item in results)
    total_wall = sum(item['transcriptionWallSeconds'] for item in results)
    report['estimate'] = {
        'sampledAudioSeconds': total_audio, 'sampledTranscriptionSeconds': total_wall,
        'sampleFraction': total_audio/report['sourceDurationSeconds'],
        'weightedFullTranscriptionSeconds': report['sourceDurationSeconds'] * total_wall / total_audio,
        'fastestSampleExtrapolationSeconds': report['sourceDurationSeconds'] * min(item['transcriptionWallSeconds']/item['durationSeconds'] for item in results),
        'slowestSampleExtrapolationSeconds': report['sourceDurationSeconds'] * max(item['transcriptionWallSeconds']/item['durationSeconds'] for item in results),
        'scope': 'Automatic transcription only; excludes one-time setup, manual verification, speaker attribution, visual review, and research synthesis.'}
    (WORK / 'benchmark.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report['estimate'], indent=2), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--extract-only', action='store_true')
    parser.add_argument('--cpu', action='store_true')
    args = parser.parse_args()
    report = extract()
    if not args.extract_only:
        transcribe(report, args.cpu)
