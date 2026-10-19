from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.reviews.models import RequestStatus, Review, VisibilityRequest


def add_review(db: Session, review: Review) -> Review:
    db.add(review)
    db.flush()
    return review


def reviews_by_reviewer(db: Session, reviewer_id: int) -> list[Review]:
    stmt = select(Review).where(Review.reviewer_id == reviewer_id).order_by(Review.decided_at.desc(), Review.id.desc())
    return list(db.scalars(stmt))


def add_request(db: Session, req: VisibilityRequest) -> VisibilityRequest:
    db.add(req)
    db.flush()
    return req


def get_request(db: Session, request_id: int) -> VisibilityRequest | None:
    return db.get(VisibilityRequest, request_id)


def pending_requests(db: Session) -> list[VisibilityRequest]:
    stmt = (
        select(VisibilityRequest)
        .where(VisibilityRequest.status == RequestStatus.PENDING.value)
        .order_by(VisibilityRequest.created_at, VisibilityRequest.id)
    )
    return list(db.scalars(stmt))


def pending_request_for_skill(db: Session, skill_id: int) -> VisibilityRequest | None:
    stmt = select(VisibilityRequest).where(
        VisibilityRequest.skill_id == skill_id, VisibilityRequest.status == RequestStatus.PENDING.value
    )
    return db.scalar(stmt)


def decided_requests_by(db: Session, user_id: int) -> list[VisibilityRequest]:
    stmt = select(VisibilityRequest).where(VisibilityRequest.decided_by == user_id)
    return list(db.scalars(stmt))


def latest_reviews(db: Session, version_ids: list[int]) -> dict[int, Review]:
    """Quyết định duyệt gần nhất của từng phiên bản (cho chủ skill xem góp ý)."""
    if not version_ids:
        return {}
    rows = db.scalars(
        select(Review).where(Review.version_id.in_(version_ids)).order_by(Review.decided_at, Review.id)
    )
    return {r.version_id: r for r in rows}  # sắp tăng dần nên bản ghi sau đè bản ghi trước
