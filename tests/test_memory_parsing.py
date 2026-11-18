"""Extracting the <memory> block from model output, including cut-off responses."""

import unittest

from types import SimpleNamespace as Block

from backend.memory_parsing import parse_memory_block, split_response


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


class TestSplitResponse(unittest.TestCase):
    def test_text_plus_tool_call(self):
        blocks = [
            Block(type="text", text="SUMMARY: weak breadth."),
            Block(type="tool_use", name="record_memory", input={"observations": [], "predictions": []}),
        ]
        text, memory = split_response(blocks)
        self.assertEqual(text, "SUMMARY: weak breadth.")
        self.assertEqual(memory, {"observations": [], "predictions": []})

    def test_text_blocks_around_the_tool_call_are_joined(self):
        blocks = [
            Block(type="text", text="SUMMARY."),
            Block(type="tool_use", name="record_memory", input={"observations": []}),
            Block(type="text", text="SIGNALS."),
        ]
        text, _ = split_response(blocks)
        self.assertEqual(text, "SUMMARY.\nSIGNALS.")

    def test_no_tool_call_falls_back_to_inline_memory_block(self):
        blocks = [Block(type="text", text='SUMMARY.\n<memory>{"observations": []}</memory>')]
        text, memory = split_response(blocks)
        self.assertEqual(text, "SUMMARY.")
        self.assertEqual(memory, {"observations": []})

    def test_tool_call_wins_over_inline_block_and_text_is_still_cleaned(self):
        blocks = [
            Block(type="text", text='SUMMARY.\n<memory>{"observations": ["inline"]}</memory>'),
            Block(type="tool_use", name="record_memory", input={"observations": ["tool"]}),
        ]
        text, memory = split_response(blocks)
        self.assertEqual(text, "SUMMARY.")
        self.assertEqual(memory, {"observations": ["tool"]})

    def test_other_tools_and_thinking_blocks_are_ignored(self):
        blocks = [
            Block(type="thinking", thinking="..."),
            Block(type="tool_use", name="something_else", input={"x": 1}),
            Block(type="text", text="SUMMARY."),
        ]
        self.assertEqual(split_response(blocks), ("SUMMARY.", None))

    def test_empty_response(self):
        self.assertEqual(split_response([]), ("", None))


if __name__ == "__main__":
    unittest.main()
