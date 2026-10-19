"""Lịch ngày làm việc (D31): thứ hai–thứ sáu, thứ bảy cách tuần, bỏ ngày lễ."""
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from app.core.config import Settings


@dataclass(frozen=True)
class WorkCalendar:
    tz: ZoneInfo
    saturday_anchor: date | None = None
    holidays: frozenset[date] = field(default_factory=frozenset)

    def is_working_day(self, d: date) -> bool:
        if d in self.holidays:
            return False
        weekday = d.weekday()  # 0 = thứ hai
        if weekday < 5:
            return True
        if weekday == 5 and self.saturday_anchor is not None:
            return (d - self.saturday_anchor).days % 14 == 0
        return False

    def add_working_days(self, start: datetime, days: int) -> datetime:
        """Mốc thời gian sau `days` ngày làm việc, cùng giờ trong ngày (theo múi giờ lịch)."""
        local = start.astimezone(self.tz)
        d = local.date()
        remaining = days
        while remaining > 0:
            d += timedelta(days=1)
            if self.is_working_day(d):
                remaining -= 1
        return local.replace(year=d.year, month=d.month, day=d.day)

    def is_overdue(self, start: datetime, now: datetime, days: int) -> bool:
        return now > self.add_working_days(start, days)


def calendar_from_settings(settings: Settings) -> WorkCalendar:
    holidays = frozenset(
        date.fromisoformat(x.strip()) for x in settings.work_holidays.split(",") if x.strip()
    )
    return WorkCalendar(
        tz=ZoneInfo(settings.work_timezone),
        saturday_anchor=settings.work_saturday_anchor,
        holidays=holidays,
    )
