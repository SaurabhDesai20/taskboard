import itertools

import pytest
from sqlalchemy.orm import Session

from app.core.errors import Conflict
from app.repositories import workspaces as workspaces_repo
from app.schemas.workspace import WorkspaceCreate
from app.services import workspaces as workspaces_service
from app.services.workspaces import derive_slug, slug_candidates
from tests.factories import create_user, create_workspace


@pytest.mark.parametrize(
    ("name", "slug"),
    [
        ("Acme", "acme"),
        ("Acme Inc.", "acme-inc"),
        ("  Hello,   World!! ", "hello-world"),
        ("R&D 2026", "r-d-2026"),
        ("snake_case_name", "snake-case-name"),
        ("--Already-Sluggy--", "already-sluggy"),
        ("2026", "2026"),
        ("Café", "caf"),
        ("!!!", "workspace"),
        ("日本語", "workspace"),
        ("a" * 60, "a" * 48),
        # Truncating at 48 must not leave a trailing dash.
        ("a" * 47 + " b", "a" * 47),
    ],
)
def test_derive_slug(name: str, slug: str) -> None:
    assert derive_slug(name) == slug


def test_slug_candidates_append_increasing_suffixes() -> None:
    assert list(itertools.islice(slug_candidates("acme"), 4)) == [
        "acme",
        "acme-2",
        "acme-3",
        "acme-4",
    ]


def test_slug_candidates_shorten_the_base_to_fit_48_chars() -> None:
    base = "a" * 45 + "-bc"  # 48 chars
    candidates = list(itertools.islice(slug_candidates(base), 12))

    assert candidates[0] == base
    # base[:46] ends with "-", which is dropped before the suffix.
    assert candidates[1] == "a" * 45 + "-2"
    assert candidates[11] == "a" * 45 + "-12"
    assert all(len(slug) <= 48 for slug in candidates)


def test_create_retries_when_a_concurrent_create_takes_the_derived_slug(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    create_workspace(db_session, slug="acme")
    user = create_user(db_session)
    real_existing_slugs = workspaces_repo.existing_slugs
    lookups: list[list[str]] = []

    def stale_then_real(db: Session, slugs: list[str]) -> set[str]:
        lookups.append(slugs)
        # The first lookup misses "acme", as if another request inserted it just after.
        return set() if len(lookups) == 1 else real_existing_slugs(db, slugs)

    monkeypatch.setattr(workspaces_repo, "existing_slugs", stale_then_real)

    created = workspaces_service.create(db_session, user.id, WorkspaceCreate(name="Acme"))

    assert created.slug == "acme-2"
    assert len(lookups) == 2


def test_create_gives_up_after_repeatedly_losing_the_slug_race(
    db_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    create_workspace(db_session, slug="acme")
    user = create_user(db_session)
    monkeypatch.setattr(workspaces_repo, "existing_slugs", lambda _db, _slugs: set())

    with pytest.raises(Conflict) as exc_info:
        workspaces_service.create(db_session, user.id, WorkspaceCreate(name="Acme"))

    assert exc_info.value.details == {"reason": "slug_taken"}
    assert workspaces_service.list_for_user(db_session, user.id) == []
