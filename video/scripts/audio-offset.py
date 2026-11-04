"""Measure where SFX probes land in a rendered MP4 (sound-design §4.6).
Usage: python scripts/audio-offset.py out/film.mp4 <src>:<target_peak_frame> ...
Prints, per probe, the frame where the source file's energy peak actually lands, minus the target."""
import subprocess, sys
import numpy as np

SR = 48000

def pcm(path, start=None, dur=None):
    cmd = ['ffmpeg', '-v', 'error']
    if start is not None:
        cmd += ['-ss', f'{start:.4f}', '-t', f'{dur:.4f}']
    cmd += ['-i', path, '-vn', '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-']
    return np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, dtype=np.float32)

film = sys.argv[1]
for probe in sys.argv[2:]:
    src, target = probe.rsplit(':', 1)
    target = float(target)
    ref = pcm(f'public/audio/sfx/{src}')
    peak = int(np.argmax(np.convolve(ref ** 2, np.ones(480), 'same')))  # 10 ms energy peak in the source
    win0 = max(0.0, target / 30 - 0.5)
    seg = pcm(film, win0, 1.0 + len(ref) / SR)
    corr = np.correlate(seg, ref, 'valid')
    norm = np.sqrt(np.convolve(seg ** 2, np.ones(len(ref)), 'valid')) * np.linalg.norm(ref) + 1e-9
    k = int(np.argmax(corr / norm))
    landed = (win0 * SR + k + peak) / SR * 30
    print(f'{src} target {target:.2f}f landed {landed:.2f}f error {landed - target:+.2f}f (ncc {float((corr / norm)[k]):.2f})')
