import unittest

from pilot import SAMPLES, absolute_segment, timestamp


class PilotTests(unittest.TestCase):
    def test_exported_timestamps_point_to_the_original_recording(self):
        segment = absolute_segment({'offsets': {'from': 1250, 'to': 7250}, 'text': ' Contoh klausul. '}, 5400)
        self.assertEqual(segment, {'start': 5401.25, 'end': 5407.25, 'text': 'Contoh klausul.'})
        self.assertEqual(timestamp(segment['start']), '01:30:01,250')
        self.assertEqual(timestamp(59.9996), '00:01:00,000')
        self.assertEqual(len(SAMPLES), 3)
        self.assertEqual(sum(length for _, _, length in SAMPLES), 360)
        self.assertTrue(all(length <= 120 for _, _, length in SAMPLES))


if __name__ == '__main__':
    unittest.main()
