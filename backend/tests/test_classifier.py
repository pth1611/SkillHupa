import pytest

from app.modules.skills import classifier, packaging, taxonomy
from tests.test_reviews import World


@pytest.fixture
def w(client):
    return World(client.app)


def _info(name: str, description: str, body: str = "", files: tuple[str, ...] = ()) -> packaging.PackageInfo:
    return packaging.PackageInfo(
        files=[packaging.PackageFile(path=p, size=1, sha256="x", is_text=False) for p in files],
        skill_md=f"---\nname: {name}\ndescription: {description}\n---\n{body}",
        frontmatter={"name": name, "description": description},
    )


def test_signals_use_valid_slugs_only():
    sig = taxonomy.load_signals()
    assert set(sig["output_types"]) == set(taxonomy.allowed(taxonomy.OUTPUT_TYPE))
    assert set(sig["ecosystems"]) == set(taxonomy.allowed(taxonomy.ECOSYSTEM))


def test_output_type_from_extensions_and_keywords():
    got = classifier.suggest(_info("Báo cáo tuần", "Tạo bảng tính excel", files=("a.xlsx", "b.xlsx")))
    assert "spreadsheet" in got.output_types


def test_ecosystem_from_keywords():
    got = classifier.suggest(_info("PR helper", "Review pull request trên GitHub", "Dùng gh cli với github actions"))
    assert got.ecosystems == ["github"]


def test_keyword_needs_word_boundary():
    got = classifier.suggest(_info("Copyright", "Tools right now", "nothing about any service"))
    assert got.ecosystems == []


def test_below_threshold_gives_no_suggestion():
    got = classifier.suggest(_info("Hello", "Greets the user"))
    assert got.output_types == [] and got.ecosystems == [] and got.category_slug is None


def test_category_from_keywords():
    got = classifier.suggest(_info("Tuyển dụng", "Sàng lọc resume cho recruitment và onboarding"))
    assert got.category_slug == "nhan-su"


# ---- gợi ý tên hiển thị -----------------------------------------------------


def test_name_from_slug_is_prettified():
    assert classifier.suggest_name(_info("remotion-best-practices", "x")) == "Remotion Best Practices"


def test_name_prefers_h1_title():
    info = _info("ssh-deploy-skill", "x", "# Triển khai qua SSH\n\nnội dung")
    assert classifier.suggest_name(info) == "Triển khai qua SSH"


def test_human_readable_name_gets_no_suggestion():
    assert classifier.suggest_name(_info("Báo cáo tuần", "x", "# Báo cáo tuần")) is None
    assert classifier.suggest_name(_info("Báo cáo tuần", "x")) is None


# ---- nguồn facet và backfill -------------------------------------------------


def test_auto_facets_never_override_manual_and_manual_replaces_auto(client):
    from app.core.database import get_session_factory
    from app.modules.skills import repository, service
    from tests.test_reviews import World

    w = World(client.app)
    sid, _, _ = w.submit()
    guess = classifier.Suggestion(output_types=["code"], ecosystems=["github"], output_scores={"code": 3}, ecosystem_scores={"github": 2})
    with get_session_factory()() as db:
        service.set_classification(db, sid, ["document"], None)  # người chọn output
        assert service.apply_auto_classification(db, sid, guess)
        db.commit()
        facets = repository.facet_slugs_of(db, [sid])[sid]
        assert facets["output_type"] == ["document"]  # giữ giá trị người chọn
        assert facets["ecosystem"] == ["github"]
        assert repository.auto_facet_slugs(db, sid) == {"output_type": [], "ecosystem": ["github"]}
        service.set_classification(db, sid, None, ["jira"])  # người chọn thay thế gợi ý
        db.commit()
        assert repository.auto_facet_slugs(db, sid)["ecosystem"] == []


def test_backfill_fills_skills_without_facets_and_dry_run_writes_nothing(client):
    from app.core.config import get_settings
    from app.core.database import get_session_factory
    from app.core.storage import get_storage
    from app.jobs import backfill_classification
    from app.modules.skills import repository
    from tests.test_reviews import World

    w = World(client.app)
    sid, _, _ = w.submit()
    with get_session_factory()() as db:
        dry = backfill_classification.run(db, get_settings(), get_storage(), dry_run=True)
        db.rollback()
        assert dry["checked"] == 1 and repository.facet_slugs_of(db, [sid]) == {}
        done = backfill_classification.run(db, get_settings(), get_storage())
        db.commit()
        assert done["checked"] == 1 and done["updated"] == 1
        assert repository.facet_slugs_of(db, [sid])[sid]["output_type"] == ["document"]
        assert backfill_classification.run(db, get_settings(), get_storage())["checked"] == 0  # chạy lại không đụng


# ---- Manager/Reviewer phân loại thủ công và tự động -------------------------------


def _skill_with_package(w, body="Tạo bảng tính excel và xuất báo cáo spreadsheet", **files):
    from tests.test_reviews import package

    sid, _, _ = w.submit(data=package(body=body, **files))
    return sid


def test_staff_manual_classification(w):
    from tests.conftest import csrf_headers

    sid = _skill_with_package(w)
    for who in (w.reviewer, w.manager):
        r = who.put(f"/api/skills/{sid}/classification", json={"output_types": ["spreadsheet"], "ecosystems": []},
                    headers=csrf_headers(who))
        assert r.status_code == 200, r.text
        assert r.json()["output_types"] == ["spreadsheet"]
    bad = w.manager.put(f"/api/skills/{sid}/classification", json={"output_types": ["nope"]},
                        headers=csrf_headers(w.manager))
    assert bad.status_code == 400
    assert w.user.put(f"/api/skills/{sid}/classification", json={"output_types": []},
                      headers=csrf_headers(w.user)).status_code == 403


def test_staff_auto_classification_keeps_manual_unless_forced(w):
    from tests.conftest import csrf_headers

    sid = _skill_with_package(w, **{"a.xlsx": "x", "b.xlsx": "y"})
    h = csrf_headers(w.manager)
    assert w.reviewer.post(f"/api/skills/{sid}/classification/auto", json={},
                           headers=csrf_headers(w.reviewer)).status_code == 403
    r = w.manager.post(f"/api/skills/{sid}/classification/auto", json={}, headers=h)
    assert r.status_code == 200, r.text
    assert "spreadsheet" in r.json()["output_types"]

    w.manager.put(f"/api/skills/{sid}/classification", json={"output_types": ["document"]},
                  headers=csrf_headers(w.manager))
    kept = w.manager.post(f"/api/skills/{sid}/classification/auto", json={}, headers=h).json()
    assert kept["output_types"] == ["document"]
    forced = w.manager.post(f"/api/skills/{sid}/classification/auto", json={"force": True}, headers=h).json()
    assert "spreadsheet" in forced["output_types"]
    assert w.user.post(f"/api/skills/{sid}/classification/auto", json={},
                       headers=csrf_headers(w.user)).status_code == 403
