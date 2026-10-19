from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from app.shared.workcalendar import WorkCalendar

TZ = ZoneInfo("Asia/Ho_Chi_Minh")


def cal(anchor=None, holidays=()):
    return WorkCalendar(tz=TZ, saturday_anchor=anchor, holidays=frozenset(holidays))


def test_weekdays_work_sunday_does_not():
    c = cal()
    assert c.is_working_day(date(2026, 10, 12))  # thứ hai
    assert c.is_working_day(date(2026, 10, 16))  # thứ sáu
    assert not c.is_working_day(date(2026, 10, 17))  # thứ bảy, chưa cấu hình mốc
    assert not c.is_working_day(date(2026, 10, 18))  # chủ nhật


def test_alternate_saturdays():
    anchor = date(2026, 10, 17)  # một thứ bảy làm việc
    c = cal(anchor)
    assert c.is_working_day(date(2026, 10, 17))
    assert not c.is_working_day(date(2026, 10, 24))
    assert c.is_working_day(date(2026, 10, 31))
    assert c.is_working_day(date(2026, 10, 3))  # trước mốc cũng cách 14 ngày


def test_holiday_is_skipped():
    c = cal(holidays=[date(2026, 10, 14)])
    assert not c.is_working_day(date(2026, 10, 14))


def test_add_working_days_skips_weekend():
    c = cal()
    start = datetime(2026, 10, 16, 3, 0, tzinfo=UTC)  # thứ sáu 10:00 giờ VN
    end = c.add_working_days(start, 1)
    assert end.astimezone(TZ).date() == date(2026, 10, 19)  # thứ hai


def test_add_working_days_uses_working_saturday():
    c = cal(date(2026, 10, 17))
    start = datetime(2026, 10, 16, 3, 0, tzinfo=UTC)
    assert c.add_working_days(start, 1).astimezone(TZ).date() == date(2026, 10, 17)


def test_is_overdue_boundary():
    c = cal()
    start = datetime(2026, 10, 12, 3, 0, tzinfo=UTC)  # thứ hai
    on_time = datetime(2026, 10, 13, 2, 0, tzinfo=UTC)
    late = datetime(2026, 10, 13, 4, 0, tzinfo=UTC)
    assert not c.is_overdue(start, on_time, 1)
    assert c.is_overdue(start, late, 1)
