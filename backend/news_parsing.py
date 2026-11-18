"""Parsing ShareSansar's HTML news listings. Stdlib only, so it tests without the backend deps.

ShareSansar removed its RSS feed in April 2026, so the listing pages
(/category/latest and friends) are the only source left.
"""

import html
import re
from datetime import datetime, timedelta, timezone

NPT = timezone(timedelta(hours=5, minutes=45))

_BLOCK_START = '<div class="featured-news-list'
_LINK = re.compile(r'href="(https?://[^"]*/newsdetail/[^"]+)"')
_TITLE = re.compile(r'<h4 class="featured-news-title">(.*?)</h4>', re.S)
_DATE = re.compile(r'<span class="text-org">\s*([^<]+?)\s*</span>')


def _published_at(date_text: str | None, now: datetime, position: int) -> datetime:
    """Turn a listing's day-only date into a timestamp.

    The page says which day, never what time. An article dated today was
    published in the last poll interval, so "now" is close; `position` keeps the
    page's newest-first order. Older days get noon NPT.
    """
    seen = now - timedelta(seconds=position)
    if not date_text:
        return seen
    try:
        day = datetime.strptime(date_text, "%A, %B %d, %Y").date()
    except ValueError:
        return seen
    if day >= now.astimezone(NPT).date():
        return seen
    return datetime(day.year, day.month, day.day, 12, tzinfo=NPT).astimezone(timezone.utc)


def parse_sharesansar_listing(page: str, now: datetime) -> list[dict]:
    """Extract articles from a ShareSansar category page, newest first.

    Returns an empty list when the markup no longer matches; the caller treats
    that as a failure worth logging.
    """
    articles = []
    for position, block in enumerate(page.split(_BLOCK_START)[1:]):
        link = _LINK.search(block)
        title = _TITLE.search(block)
        if not link or not title:
            continue
        title_text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", title.group(1)))).strip()
        if not title_text:
            continue
        date = _DATE.search(block)
        articles.append({
            "guid": link.group(1),
            "title": title_text,
            "link": link.group(1),
            "summary": "",
            "source": "sharesansar",
            "published_at": _published_at(date.group(1) if date else None, now, position),
        })
    return articles
