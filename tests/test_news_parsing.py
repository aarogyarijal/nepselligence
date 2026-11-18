"""Parsing ShareSansar listing pages, the replacement for its removed RSS feed."""

import unittest
from datetime import datetime, timezone

from backend.news_parsing import parse_sharesansar_listing

# 2026-11-18 13:45 NPT
NOW = datetime(2026, 11, 18, 8, 0, tzinfo=timezone.utc)


def block(slug: str, title: str, date: str) -> str:
    """One article as ShareSansar renders it on /category/latest."""
    url = f"https://www.sharesansar.com/newsdetail/{slug}"
    return f"""<div class="featured-news-list margin-bottom-15">
    <div class="col-md-2 col-sm-2 col-xs-3 hidden-xs">
        <a href="{url}">
            <img src="https://content.sharesansar.com/photos/x.png" class="img-responsive" alt="" />
        </a>
    </div>
    <div class="col-md-10 col-sm-10 col-xs-12">
        <a href="{url}" title="{title}">
            <h4 class="featured-news-title">{title}</h4>
        </a>
        <p><span class="text-org">{date}</span>
        </p>
    </div>
    <div class="clearfix"></div>
</div>
"""


PAGE = (
    '<html><a href="/newsdetail/capital-plan-of-commercial-bank">Commercial Banks</a>'
    '<div class="newslist">'
    + block("nabil-dividend-2026-11-18", "NABIL Proposes 12% Dividend", "Wednesday, November 18, 2026")
    + block("ipo-opens-2026-11-18", "Company&#039;s IPO Opens", "Wednesday, November 18, 2026")
    + block("old-news-2026-11-16", "Old News", "Monday, November 16, 2026")
    + "</div></html>"
)


class TestParseSharesansarListing(unittest.TestCase):
    def test_extracts_each_article_and_skips_nav_links(self):
        articles = parse_sharesansar_listing(PAGE, NOW)
        self.assertEqual(
            [a["title"] for a in articles],
            ["NABIL Proposes 12% Dividend", "Company's IPO Opens", "Old News"],
        )
        first = articles[0]
        self.assertEqual(first["link"], "https://www.sharesansar.com/newsdetail/nabil-dividend-2026-11-18")
        self.assertEqual(first["guid"], first["link"])
        self.assertEqual(first["source"], "sharesansar")

    def test_todays_articles_are_stamped_now_in_page_order(self):
        articles = parse_sharesansar_listing(PAGE, NOW)
        self.assertEqual(articles[0]["published_at"], NOW)
        self.assertLess(articles[1]["published_at"], articles[0]["published_at"])
        self.assertLess((NOW - articles[1]["published_at"]).total_seconds(), 60)

    def test_older_days_get_noon_nepal_time(self):
        old = parse_sharesansar_listing(PAGE, NOW)[2]
        self.assertEqual(old["published_at"], datetime(2026, 11, 16, 6, 15, tzinfo=timezone.utc))

    def test_today_is_judged_in_nepal_time_not_utc(self):
        """At 19:00 UTC on the 17th it is already the 18th in Nepal."""
        late = datetime(2026, 11, 17, 19, 0, tzinfo=timezone.utc)
        self.assertEqual(parse_sharesansar_listing(PAGE, late)[0]["published_at"], late)

    def test_unreadable_date_falls_back_to_now(self):
        page = block("x-1", "Title", "sometime last week")
        self.assertEqual(parse_sharesansar_listing(page, NOW)[0]["published_at"], NOW)

    def test_changed_markup_yields_nothing(self):
        self.assertEqual(parse_sharesansar_listing("<html><div class='news'>redesigned</div></html>", NOW), [])


if __name__ == "__main__":
    unittest.main()
