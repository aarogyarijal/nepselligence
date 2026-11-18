"""News ingestion (ShareSansar listing pages + OnlineKhabar RSS) for NEPSE market intelligence."""

import logging
import re
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime

import httpx
import feedparser
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert as pg_insert

from .config import settings
from .models import NewsArticle
from .news_parsing import parse_sharesansar_listing

logger = logging.getLogger(__name__)

# Categories derived from keyword matching on title + summary
# Order matters: first match wins. More specific/higher-priority categories come first.
CATEGORY_KEYWORDS = {
    "ipo": ["ipo", "fpo", "initial public offering", "further public offering", "primary issue", "existing issue", "right share", "right issue"],
    "dividend": ["cash dividend", "bonus share", "final dividend", "interim dividend", "book closure", "dividend distribution"],
    "corporate": ["board meeting", "agm", "egm", "merger", "acquisition", "ceo", "chairman", "management", "promoter", "listing"],
    "market": ["nepse", "nifty", "index", "market summary", "trading session", "bull", "bear", "all-time high", "52-week"],
    "policy": ["nrb", "nepal rastra bank", "monetary policy", "interest rate", "ccd ratio", "refinancing", "sebon", "securities board"],
}


def clean_html(html: str) -> str:
    """Strip HTML tags and decode basic entities from RSS description CDATA."""
    if not html:
        return ""
    # Remove HTML tags
    text = re.sub(r"<[^>]+>", " ", html)
    # Decode common HTML entities
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    text = text.replace("&nbsp;", " ").replace("&quot;", '"').replace("&#39;", "'")
    # Collapse whitespace
    return re.sub(r"\s+", " ", text).strip()


def categorize_article(title: str, summary: str) -> str:
    """Classify article into a category based on keyword matching."""
    text = (title + " " + (summary or "")).lower()
    for category, keywords in CATEGORY_KEYWORDS.items():
        if any(kw in text for kw in keywords):
            return category
    return "general"


def extract_symbols(text: str, known_symbols: set[str]) -> list[str]:
    """Extract NEPSE stock symbols mentioned in text via word-boundary matching.

    Only matches symbols of 3+ characters to avoid false positives with short
    English words (e.g. "SBI" is fine, but "AN" might match "any" etc.).
    """
    found = []
    text_upper = text.upper()
    for symbol in known_symbols:
        if len(symbol) < 3:
            continue
        # Word boundary match — symbol must not be surrounded by alphanumeric chars
        pattern = r"(?<![A-Z0-9])" + re.escape(symbol) + r"(?![A-Z0-9])"
        if re.search(pattern, text_upper):
            found.append(symbol)
    return sorted(set(found))


def _parse_rss_date(entry) -> datetime:
    """Parse feedparser entry date, falling back to now."""
    if hasattr(entry, "published"):
        try:
            return parsedate_to_datetime(entry.published).astimezone(timezone.utc)
        except Exception:
            pass
    if hasattr(entry, "published_parsed") and entry.published_parsed:
        import time
        ts = time.mktime(entry.published_parsed)
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    return datetime.now(timezone.utc)


async def _get_text(url: str) -> str:
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        response = await client.get(url, headers={"User-Agent": "NepselligenceBot/1.0"})
        response.raise_for_status()
        return response.text


async def fetch_sharesansar() -> list[dict]:
    """Scrape ShareSansar's listing pages (it has no RSS feed any more)."""
    now = datetime.now(timezone.utc)
    by_guid: dict[str, dict] = {}
    for url in settings.news_sharesansar_pages:
        try:
            page = await _get_text(url)
        except Exception as e:
            logger.error(f"Failed to fetch ShareSansar page {url}: {e}")
            continue
        found = parse_sharesansar_listing(page, now)
        if not found:
            logger.error(f"No articles parsed from {url}: ShareSansar's markup may have changed")
        for art in found:
            by_guid.setdefault(art["guid"], art)

    logger.info(f"Fetched {len(by_guid)} articles from ShareSansar")
    return list(by_guid.values())


async def fetch_rss(url: str, source: str) -> list[dict]:
    """Fetch and parse an RSS feed. Returns list of normalized article dicts."""
    try:
        raw_xml = await _get_text(url)
    except Exception as e:
        logger.error(f"Failed to fetch {source} RSS: {e}")
        return []

    feed = feedparser.parse(raw_xml)
    articles = []
    for entry in feed.entries:
        guid = getattr(entry, "id", None) or getattr(entry, "link", None)
        if not guid:
            continue
        title = getattr(entry, "title", "").strip()
        if not title:
            continue
        link = getattr(entry, "link", "").strip()
        # Description may be HTML in CDATA — clean it
        raw_summary = ""
        if hasattr(entry, "summary"):
            raw_summary = entry.summary
        elif hasattr(entry, "description"):
            raw_summary = entry.description
        summary = clean_html(raw_summary)

        articles.append({
            "guid": guid,
            "title": title,
            "link": link,
            "summary": summary,
            "source": source,
            "published_at": _parse_rss_date(entry),
        })

    if not articles:
        logger.error(f"{source} RSS at {url} returned no articles")
    logger.info(f"Fetched {len(articles)} articles from {source} RSS")
    return articles


def _get_known_symbols(db: Session) -> set[str]:
    """Load all known stock symbols from the database."""
    from sqlalchemy import text as sql_text
    rows = db.execute(sql_text("SELECT DISTINCT symbol FROM stock_prices")).fetchall()
    return {r.symbol for r in rows}


async def ingest_news(db: Session) -> int:
    """Fetch news from all configured sources and persist new articles.

    Returns the number of new articles inserted.
    """
    articles = await fetch_sharesansar()
    articles += await fetch_rss(settings.news_rss_onlinekhabar, "onlinekhabar")
    if not articles:
        return 0

    known_symbols = _get_known_symbols(db)
    now = datetime.now(timezone.utc)
    inserted = 0

    for art in articles:
        combined_text = art["title"] + " " + (art["summary"] or "")
        symbols = extract_symbols(combined_text, known_symbols)
        category = categorize_article(art["title"], art["summary"] or "")

        try:
            stmt = pg_insert(NewsArticle).values(
                guid=art["guid"],
                title=art["title"],
                link=art["link"],
                summary=art["summary"],
                source=art["source"],
                published_at=art["published_at"],
                fetched_at=now,
                symbols=symbols,
                category=category,
            )
            stmt = stmt.on_conflict_do_nothing(index_elements=["guid"])
            result = db.execute(stmt)
            if result.rowcount:
                inserted += 1
        except Exception as e:
            logger.warning(f"Failed to insert article '{art['title'][:60]}': {e}")
            db.rollback()
            continue

    db.commit()
    logger.info(f"News ingestion complete: {inserted} new articles inserted ({len(articles)} fetched)")
    return inserted


async def cleanup_old_news(db: Session, retention_days: int = None) -> int:
    """Delete news articles older than retention_days."""
    days = retention_days or settings.news_retention_days
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    from sqlalchemy import delete
    result = db.execute(delete(NewsArticle).where(NewsArticle.published_at < cutoff))
    db.commit()
    logger.info(f"Deleted {result.rowcount} old news articles (cutoff: {days} days)")
    return result.rowcount
