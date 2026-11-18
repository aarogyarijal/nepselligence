"""Extracting the <memory> block from model output, including cut-off responses."""

import unittest

from backend.memory_parsing import parse_memory_block


class TestParseMemoryBlock(unittest.TestCase):
    def test_complete_block_is_stripped_and_parsed(self):
        text, memory = parse_memory_block('SUMMARY: flat day.\n<memory>{"observations": []}</memory>')
        self.assertEqual(text, "SUMMARY: flat day.")
        self.assertEqual(memory, {"observations": []})

    def test_no_block(self):
        text, memory = parse_memory_block("SUMMARY: flat day.")
        self.assertEqual(text, "SUMMARY: flat day.")
        self.assertIsNone(memory)

    def test_garbage_block_yields_no_memory(self):
        text, memory = parse_memory_block("SUMMARY.\n<memory>not json at all</memory>")
        self.assertEqual(text, "SUMMARY.")
        self.assertIsNone(memory)

    def test_cut_off_after_a_comma_inside_nested_array(self):
        """The real failure: output hit the token limit inside regime.leading_sectors."""
        raw = (
            'SUMMARY.\n<memory>\n{"observations": [{"text": "a"}], '
            '"predictions": [{"text": "p", "target_days": 1}], '
            '"regime": {"trend": "bearish", "leading_sectors": ["Mutual Fund",'
        )
        text, memory = parse_memory_block(raw)
        self.assertEqual(text, "SUMMARY.")
        self.assertEqual(memory["predictions"], [{"text": "p", "target_days": 1}])
        self.assertEqual(memory["regime"], {"trend": "bearish", "leading_sectors": ["Mutual Fund"]})

    def test_cut_off_mid_string_drops_the_unfinished_item(self):
        raw = '<memory>{"observations": [{"text": "kept"}, {"text": "half wri'
        _, memory = parse_memory_block(raw)
        self.assertEqual(memory, {"observations": [{"text": "kept"}]})

    def test_cut_off_after_a_key_drops_that_key(self):
        raw = '<memory>{"observations": [{"text": "kept", "confidence":'
        _, memory = parse_memory_block(raw)
        self.assertEqual(memory, {"observations": [{"text": "kept"}]})

    def test_brackets_inside_strings_are_ignored(self):
        raw = '<memory>{"observations": [{"text": "range [540, 560} \\"quoted\\""}], "patterns": ['
        _, memory = parse_memory_block(raw)
        self.assertEqual(memory["observations"][0]["text"], 'range [540, 560} "quoted"')
        self.assertEqual(memory["patterns"], [])

    def test_cut_off_before_any_complete_value(self):
        _, memory = parse_memory_block('<memory>{"observ')
        self.assertIsNone(memory)


if __name__ == "__main__":
    unittest.main()
