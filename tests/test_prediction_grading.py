"""Rules for grading AI predictions in code and scoring them against a baseline."""

import unittest

from backend.prediction_grading import (
    describe,
    grade,
    normalize_condition,
    summarize,
    valid_target_days,
)


class TestNormalizeCondition(unittest.TestCase):
    def test_stock_price_condition(self):
        cond = normalize_condition(
            {"metric": "price", "symbol": "nabil", "direction": "Above", "threshold": "560"}
        )
        self.assertEqual(
            cond, {"metric": "price", "symbol": "NABIL", "direction": "above", "threshold": 560.0}
        )

    def test_symbol_falls_back_to_prediction_symbol(self):
        cond = normalize_condition({"metric": "ltp", "direction": "below", "threshold": 500}, "SAIL")
        self.assertEqual(cond["symbol"], "SAIL")
        self.assertEqual(cond["metric"], "price")

    def test_nepse_symbol_means_the_index(self):
        cond = normalize_condition(
            {"metric": "change_pct", "symbol": "NEPSE", "direction": "above", "threshold": 1.5}
        )
        self.assertIsNone(cond["symbol"])
        self.assertEqual(cond["metric"], "change_pct")

    def test_price_without_symbol_is_the_index(self):
        cond = normalize_condition({"metric": "price", "direction": "above", "threshold": 2700})
        self.assertEqual(cond["metric"], "nepse_index")
        self.assertIsNone(cond["symbol"])

    def test_ungradable_conditions_are_rejected(self):
        bad = [
            None,
            "price above 500",
            {},
            {"metric": "rsi", "symbol": "NABIL", "direction": "below", "threshold": 60},
            {"metric": "price", "symbol": "NABIL", "direction": "sideways", "threshold": 500},
            {"metric": "price", "symbol": "NABIL", "direction": "above"},
            {"metric": "price", "symbol": "NABIL", "direction": "above", "threshold": "high"},
            {"metric": "price", "symbol": "NABIL", "direction": "above", "threshold": float("nan")},
            {"metric": "price", "symbol": "NABIL", "direction": "above", "threshold": True},
        ]
        for conditions in bad:
            self.assertIsNone(normalize_condition(conditions), conditions)


class TestValidTargetDays(unittest.TestCase):
    def test_accepts_one_to_thirty(self):
        self.assertEqual(valid_target_days(1), 1)
        self.assertEqual(valid_target_days(30), 30)
        self.assertEqual(valid_target_days("5"), 5)

    def test_rejects_missing_or_out_of_range(self):
        for value in (None, 0, -2, 31, 2.5, "soon", True):
            self.assertIsNone(valid_target_days(value), value)


class TestGrade(unittest.TestCase):
    PRICE_ABOVE = {"metric": "price", "symbol": "NABIL", "direction": "above", "threshold": 560.0}
    PRICE_BELOW = {"metric": "price", "symbol": "NABIL", "direction": "below", "threshold": 540.0}

    def test_breakout_that_happened_beats_the_baseline(self):
        result = grade(self.PRICE_ABOVE, start_value=549.0, end_value=565.0)
        self.assertEqual(result["status"], "confirmed")
        self.assertFalse(result["baseline_correct"])

    def test_breakout_that_failed_loses_to_the_baseline(self):
        result = grade(self.PRICE_ABOVE, start_value=549.0, end_value=551.0)
        self.assertEqual(result["status"], "invalidated")
        self.assertTrue(result["baseline_correct"])

    def test_claim_already_true_earns_no_edge(self):
        result = grade(self.PRICE_ABOVE, start_value=570.0, end_value=575.0)
        self.assertEqual(result["status"], "confirmed")
        self.assertTrue(result["baseline_correct"])

    def test_threshold_must_be_crossed_not_touched(self):
        self.assertEqual(grade(self.PRICE_ABOVE, 549.0, 560.0)["status"], "invalidated")
        self.assertEqual(grade(self.PRICE_BELOW, 549.0, 540.0)["status"], "invalidated")
        self.assertEqual(grade(self.PRICE_BELOW, 549.0, 539.9)["status"], "confirmed")

    def test_change_pct_is_measured_from_the_prediction_date(self):
        cond = {"metric": "change_pct", "symbol": None, "direction": "below", "threshold": -1.0}
        result = grade(cond, start_value=2600.0, end_value=2561.0)
        self.assertEqual(result["status"], "confirmed")
        self.assertEqual(result["observed"], -1.5)
        self.assertFalse(result["baseline_correct"])

    def test_no_grade_without_target_date_value(self):
        self.assertIsNone(grade(self.PRICE_ABOVE, start_value=549.0, end_value=None))

    def test_change_pct_needs_a_start_value(self):
        cond = {"metric": "change_pct", "symbol": "SAIL", "direction": "above", "threshold": 2.0}
        self.assertIsNone(grade(cond, start_value=None, end_value=1300.0))
        self.assertIsNone(grade(cond, start_value=0, end_value=1300.0))

    def test_price_grades_without_start_value_but_has_no_baseline(self):
        result = grade(self.PRICE_ABOVE, start_value=None, end_value=565.0)
        self.assertEqual(result["status"], "confirmed")
        self.assertIsNone(result["baseline_correct"])

    def test_describe_states_the_numbers(self):
        result = grade(self.PRICE_ABOVE, 549.0, 565.0)
        self.assertEqual(describe(self.PRICE_ABOVE, result), "NABIL at 565 met the call for above 560.")
        cond = {"metric": "change_pct", "symbol": None, "direction": "below", "threshold": -1.0}
        self.assertEqual(
            describe(cond, grade(cond, 2600.0, 2620.0)),
            "NEPSE change of +0.77% missed the call for below -1%.",
        )


class TestSummarize(unittest.TestCase):
    def test_empty(self):
        card = summarize([])
        self.assertEqual(card["total"], 0)
        self.assertEqual(card["hit_rate_pct"], 0.0)
        self.assertIsNone(card["baseline_hit_rate_pct"])
        self.assertIsNone(card["edge_pct"])
        self.assertEqual(card["by_category"], {})

    def test_hit_rate_baseline_and_edge(self):
        records = [
            {"status": "confirmed", "baseline_correct": False, "category": "breakout"},
            {"status": "confirmed", "baseline_correct": True, "category": "breakout"},
            {"status": "invalidated", "baseline_correct": True, "category": "price_direction"},
            {"status": "invalidated", "baseline_correct": False, "category": "price_direction"},
        ]
        card = summarize(records)
        self.assertEqual(card["total"], 4)
        self.assertEqual(card["hit_rate_pct"], 50.0)
        self.assertEqual(card["baseline_hit_rate_pct"], 50.0)
        self.assertEqual(card["edge_pct"], 0.0)
        self.assertEqual(card["by_category"]["breakout"]["hit_rate_pct"], 100.0)
        self.assertEqual(card["by_category"]["breakout"]["edge_pct"], 50.0)
        self.assertEqual(card["by_category"]["price_direction"]["edge_pct"], -50.0)

    def test_expired_predictions_do_not_move_the_hit_rate(self):
        records = [
            {"status": "confirmed", "baseline_correct": False},
            {"status": "expired"},
            {"status": "expired"},
        ]
        card = summarize(records)
        self.assertEqual(card["total"], 1)
        self.assertEqual(card["expired"], 2)
        self.assertEqual(card["hit_rate_pct"], 100.0)

    def test_legacy_partial_counts_half_and_has_no_baseline(self):
        card = summarize([{"status": "partially_confirmed"}, {"status": "invalidated"}])
        self.assertEqual(card["total"], 2)
        self.assertEqual(card["hit_rate_pct"], 25.0)
        self.assertIsNone(card["edge_pct"])


if __name__ == "__main__":
    unittest.main()
