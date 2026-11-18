"""NPT helpers must give the same answer whatever timezone the server runs in."""

import os
import time
import unittest
from datetime import date, datetime, timezone
from unittest import mock

from backend import timeutil
from backend.timeutil import (
    NPT, bucket_label, npt_bucket_start, npt_date, npt_day_start, npt_today, parse_npt_time, to_npt_iso,
)


def at(utc: datetime):
    """Freeze timeutil's clock at a UTC instant."""
    class Frozen(datetime):
        @classmethod
        def now(cls, tz=None):
            return utc.astimezone(tz) if tz else utc.replace(tzinfo=None)
    return mock.patch.object(timeutil, "datetime", Frozen)


class ServerTimezoneTest(unittest.TestCase):
    """Run each check with the process clock set to several timezones."""

    ZONES = ["UTC", "America/New_York", "America/Los_Angeles", "Asia/Kathmandu", "Pacific/Auckland"]

    def each_zone(self):
        original = os.environ.get("TZ")
        try:
            for zone in self.ZONES:
                os.environ["TZ"] = zone
                time.tzset()
                yield zone
        finally:
            if original is None:
                os.environ.pop("TZ", None)
            else:
                os.environ["TZ"] = original
            time.tzset()

    def test_today_is_the_nepal_date_just_after_nepal_midnight(self):
        # 19:00 UTC on the 17th is 00:45 NPT on the 18th.
        for zone in self.each_zone():
            with at(datetime(2026, 11, 17, 19, 0, tzinfo=timezone.utc)):
                self.assertEqual(npt_today(), date(2026, 11, 18), zone)

    def test_today_is_the_nepal_date_just_before_nepal_midnight(self):
        # 18:00 UTC on the 17th is 23:45 NPT, still the 17th.
        for zone in self.each_zone():
            with at(datetime(2026, 11, 17, 18, 0, tzinfo=timezone.utc)):
                self.assertEqual(npt_today(), date(2026, 11, 17), zone)

    def test_day_start_is_nepal_midnight(self):
        for zone in self.each_zone():
            start = npt_day_start(date(2026, 11, 18))
            self.assertEqual(start.astimezone(timezone.utc), datetime(2026, 11, 17, 18, 15, tzinfo=timezone.utc), zone)

    def test_date_and_iso_of_a_timestamp(self):
        late = datetime(2026, 11, 17, 20, 0, tzinfo=timezone.utc)  # 01:45 NPT on the 18th
        for zone in self.each_zone():
            self.assertEqual(npt_date(late), date(2026, 11, 18), zone)
            self.assertEqual(to_npt_iso(late), "2026-11-18T01:45:00+05:45", zone)


    def test_a_nepse_time_without_an_offset_is_nepal_time(self):
        for zone in self.each_zone():
            trade = parse_npt_time("2026-11-18T14:26:59.367991")
            self.assertEqual(to_npt_iso(trade), "2026-11-18T14:26:59.367991+05:45", zone)
            self.assertEqual(trade.astimezone(timezone.utc).hour, 8, zone)

    def test_a_time_with_an_offset_keeps_its_instant(self):
        self.assertEqual(to_npt_iso(parse_npt_time("2026-11-18T08:41:59+00:00")), "2026-11-18T14:26:59+05:45")
        self.assertIsNone(parse_npt_time(None))


class BucketTest(unittest.TestCase):
    def epoch(self, hour, minute):
        return int(datetime(2026, 11, 18, hour, minute, tzinfo=NPT).timestamp())

    def test_hourly_buckets_start_on_the_nepal_hour(self):
        start = npt_bucket_start(self.epoch(11, 20), 60)
        self.assertEqual(bucket_label(start, 60), "2026-11-18T11:00:00+05:45")

    def test_half_hour_buckets_start_on_nepal_half_hours(self):
        start = npt_bucket_start(self.epoch(11, 50), 30)
        self.assertEqual(bucket_label(start, 30), "2026-11-18T11:30:00+05:45")

    def test_a_bucket_start_stays_in_its_own_bucket(self):
        start = npt_bucket_start(self.epoch(13, 0), 60)
        self.assertEqual(start, self.epoch(13, 0))

    def test_daily_buckets_are_plain_nepal_dates(self):
        # 00:30 NPT on the 18th is still the 17th in UTC.
        start = npt_bucket_start(self.epoch(0, 30), 1440)
        self.assertEqual(bucket_label(start, 1440), "2026-11-18")
        self.assertEqual(bucket_label(npt_bucket_start(self.epoch(14, 59), 1440), 1440), "2026-11-18")


if __name__ == "__main__":
    unittest.main()
