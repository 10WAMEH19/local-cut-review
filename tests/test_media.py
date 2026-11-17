import math
import tempfile
import unittest
from pathlib import Path
import media
from media_fixture import make_test_video


class CutValidation(unittest.TestCase):
    def test_local_cuts_leave_exact_source_intervals(self):
        cuts=[{'start':16,'end':20},{'start':20,'end':26}]
        self.assertEqual(media.kept_ranges(cuts,48),[(0,16),(26,48)])

    def test_overlap_does_not_remove_the_same_seconds_twice(self):
        cuts=[{'start':10,'end':20},{'start':15,'end':25}]
        self.assertEqual(media.kept_ranges(cuts,48),[(0,10),(25,48)])

    def test_rejects_untrusted_boundaries_and_entire_video_deletion(self):
        bad=[{'start':-1,'end':2},{'start':2,'end':2},{'start':1,'end':49},
             {'start':True,'end':2},{'start':0,'end':math.nan},{'start':0,'end':math.inf},
             {'start':0,'end':48},{'start':0,'end':1,'command':'anything'}]
        for cut in bad:
            with self.subTest(cut=cut),self.assertRaises(ValueError):media.kept_ranges([cut],48)

    def test_no_cuts_retains_full_source(self):
        self.assertEqual(media.kept_ranges([],48),[(0,48)])


class ActualExport(unittest.TestCase):
    @unittest.skipUnless(media.ffmpeg_path(),'Requires configured FFmpeg')
    def test_export_uses_actual_media_and_preserves_original(self):
        import hashlib
        with tempfile.TemporaryDirectory() as tmp:
            source = make_test_video(Path(tmp) / 'source.mp4')
            edited = Path(tmp) / 'edit.mp4'
            before = hashlib.sha256(source.read_bytes()).hexdigest()
            info = media.probe(source)
            result = media.export_video(source, edited, [{'start': 2, 'end': 4}], info)
            self.assertAlmostEqual(result['duration'], info['duration'] - 2, delta=.1)
            self.assertTrue(result['audio'])
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), before)


if __name__=='__main__':unittest.main()
