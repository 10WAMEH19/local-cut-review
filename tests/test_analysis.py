import unittest

from local_analysis import interpret_plan, repeats_text


class GroundedEditing(unittest.TestCase):
    def test_repeated_speech_can_be_proposed_but_new_instruction_is_kept(self):
        clips = [
            {'id': 'A', 'source': 'clip-one', 'duration': 18, 'windows': [], 'speech': [
                {'id': 'A1', 'start': 1, 'end': 4, 'text': 'First rinse the rice in cold water.'},
                {'id': 'A2', 'start': 6, 'end': 9, 'text': 'First rinse the rice in cold water.'},
                {'id': 'A3', 'start': 12, 'end': 15, 'text': 'First rinse the rice in cold water, then drain it twice.'},
            ]},
            {'id': 'B', 'source': 'clip-two', 'duration': 7, 'windows': [], 'speech': [
                {'id': 'B1', 'start': 1, 'end': 4, 'text': 'Check that the water runs clear.'},
            ]},
        ]
        plan = {'goal': 'Cooking tutorial', 'order': [{'id': 'A', 'reason': 'First step'}, {'id': 'B', 'reason': 'Final check'}],
                'cuts': [{'target': key, 'evidence': 'A1', 'kind': 'repeat', 'reason': 'Potential repeat'}
                         for key in ('A2', 'A3', 'fake-timecode')]}
        result = interpret_plan(plan, clips, [], '', 'Tutorial')
        self.assertEqual([(row['source'], row['start'], row['end']) for row in result['cuts']], [('clip-one', 6, 9)])
        self.assertEqual(result['cuts'][0]['comparison']['start'], 1)

    def test_repeated_prompt_may_omit_detail_but_cannot_add_it(self):
        short = "Yeah, let's go. Let's go and see."
        long = "Let's go and see what's happening in reception."
        self.assertTrue(repeats_text(short, long))
        self.assertFalse(repeats_text(long, short))


if __name__ == '__main__':
    unittest.main()
