#!/usr/bin/env python3
"""Transcribe an audio file with faster-whisper, emitting segment/word JSON.

Usage: python3 transcribe.py <audio.wav> <out.json> [--model small]
Output: {"segments": [{"id","start","end","text","words":[{"text","start","end","confidence"}]}]}
"""
import argparse
import json
import sys


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio")
    parser.add_argument("out")
    parser.add_argument("--model", default="small")
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        sys.stderr.write("faster-whisper is not installed. Run: pip install faster-whisper\n")
        return 3

    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    segments, _info = model.transcribe(args.audio, word_timestamps=True, vad_filter=True)

    out = {"segments": []}
    for i, seg in enumerate(segments):
        words = []
        for w in seg.words or []:
            words.append({
                "text": w.word.strip(),
                "start": round(float(w.start), 3),
                "end": round(float(w.end), 3),
                "confidence": round(float(w.probability), 3),
            })
        out["segments"].append({
            "id": f"seg-{i}",
            "start": round(float(seg.start), 3),
            "end": round(float(seg.end), 3),
            "text": seg.text.strip(),
            "words": words,
        })

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
