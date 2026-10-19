"""Import mọi model để đăng ký vào Base.metadata (dùng cho Alembic và test).

Thêm một dòng ở đây mỗi khi một module có `models.py` mới.
"""
from app.modules.audit import models as audit_models  # noqa: F401
from app.modules.installs import models as installs_models  # noqa: F401
from app.modules.notifications import models as notifications_models  # noqa: F401
from app.modules.reviews import models as reviews_models  # noqa: F401
from app.modules.skills import models as skills_models  # noqa: F401
from app.modules.sources import models as sources_models  # noqa: F401
from app.modules.users import models as users_models  # noqa: F401
