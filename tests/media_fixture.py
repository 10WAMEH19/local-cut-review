import media


def make_test_video(path, pattern='testsrc2'):
    media.run_media([
        '-f', 'lavfi', '-i', f'{pattern}=size=160x90:rate=30',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
        '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', str(path),
    ])
    return path
