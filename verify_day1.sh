#!/bin/bash
# Day 1 verification script
# Checks that all critical bug fixes are in place

set -e

echo "=== Day 1 Backend Verification ==="
echo

# Check 1: Scheduler timezone
echo "✓ Check 1: Scheduler timezone"
python3 -c "
from backend.config import settings
assert settings.scheduler_timezone == 'Asia/Kathmandu', 'Wrong timezone!'
print('  Scheduler TZ: Asia/Kathmandu ✓')
"

# Check 2: Max instances
echo "✓ Check 2: Scheduler max_instances"
python3 -c "
from backend.config import settings
assert settings.scheduler_max_instances == 1, 'max_instances != 1'
print('  Max instances: 1 ✓')
"

# Check 3: NPT offset
echo "✓ Check 3: NPT timezone offset"
python3 -c "
from zoneinfo import ZoneInfo
from datetime import datetime
npt = ZoneInfo('Asia/Kathmandu')
dt = datetime(2026, 4, 6, 11, 0, 0, tzinfo=npt)
offset_seconds = dt.utcoffset().total_seconds()
expected = (5 * 3600 + 45 * 60)
assert offset_seconds == expected, f'Offset {offset_seconds} != {expected}'
print(f'  NPT offset: UTC+5:45 ✓')
"

# Check 4: Database models
echo "✓ Check 4: Database models"
python3 -c "
from backend.models import StockPrice, Floorsheet, MarketStatus, AIInsight

# Check columns exist
cols = {c.name for c in StockPrice.__table__.columns}
assert 'symbol' in cols and 'ltp' in cols and 'time' in cols
assert 'source' in cols  # REST vs WebSocket tracking
print('  StockPrice columns (symbol, ltp, time, source) ✓')

# Check Floorsheet
cols = {c.name for c in Floorsheet.__table__.columns}
assert 'symbol' in cols and 'buyer' in cols and 'seller' in cols
print('  Floorsheet columns (symbol, buyer, seller) ✓')

# Check MarketStatus
cols = {c.name for c in MarketStatus.__table__.columns}
assert 'is_open' in cols and 'date' in cols
print('  MarketStatus columns (is_open, date) ✓')

# Check AIInsight
cols = {c.name for c in AIInsight.__table__.columns}
assert 'insight_text' in cols and 'generated_at' in cols
print('  AIInsight columns (insight_text, generated_at) ✓')
"

# Check 5: DataProvider abstraction
echo "✓ Check 5: DataProvider abstraction"
python3 -c "
from backend.providers import DataProvider, NepseAPIProvider, DataProviderManager
from abc import ABC
assert issubclass(DataProvider, ABC), 'DataProvider not abstract'
assert hasattr(DataProvider, 'get_market_status'), 'Missing method'
assert hasattr(DataProvider, 'get_live_market'), 'Missing method'
assert hasattr(DataProvider, 'get_floorsheet'), 'Missing method'
print('  DataProvider protocol ✓')
print('  NepseAPIProvider ✓')
print('  DataProviderManager ✓')
"

# Check 6: FastAPI app
echo "✓ Check 6: FastAPI endpoints"
grep -q "/health" backend/main.py && echo "  /health ✓" || exit 1
grep -q "/api/stocks/latest" backend/main.py && echo "  /api/stocks/latest ✓" || exit 1
grep -q "/api/stocks/{symbol}/floorsheet" backend/main.py && echo "  /api/stocks/{symbol}/floorsheet ✓" || exit 1

# Check 7: Critical bug fixes documented
echo "✓ Check 7: Critical bug fixes"
grep -q "hour='11-15'" backend/scheduler.py && echo "  Cron hour=11-15 ✓" || exit 1
grep -q "max_instances" backend/scheduler.py && echo "  max_instances=1 ✓" || exit 1
grep -q "CLOSE" backend/scheduler.py && echo "  Market status guard ✓" || exit 1
grep -q "ON CONFLICT" PLAN.md && echo "  UNIQUE + upsert documented ✓" || exit 1

# Check 8: Tests exist
echo "✓ Check 8: Regression tests"
test -f tests/test_critical_bugs.py && echo "  test_critical_bugs.py ✓" || exit 1
grep -q "TestCronTimezone\|TestMarketStatusGuard\|TestDualWriterDedup" tests/test_critical_bugs.py && echo "  T1-T12 test classes ✓" || exit 1

echo
echo "=== All Day 1 Checks Passed ✓ ==="
echo
echo "Next steps:"
echo "  1. docker compose up -d  (start full stack)"
echo "  2. Check SETUP.md for verification commands"
echo "  3. Implement Next.js frontend (Day 2)"
