"""Run whisper.cpp in the project's isolated Python environment."""
import json
import sys

from pywhispercpp.model import Model


def main():
    model = Model(sys.argv[1], language='auto', n_threads=4, context_params={'use_gpu': False}, print_progress=False,
                  print_realtime=False, print_timestamps=False, no_context=True)
    output = []
    for path in sys.argv[2:]:
        segments = model.transcribe(path, extract_probability=True)
        output.append([{'start': s.t0 / 100, 'end': s.t1 / 100, 'text': s.text,
                        'probability': float(s.probability)} for s in segments if s.text])
    print(json.dumps(output, ensure_ascii=False))


if __name__ == '__main__':
    main()
