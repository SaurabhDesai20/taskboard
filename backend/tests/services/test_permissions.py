"""The role permission matrix (PLAN.md section 4). Pure: no database."""

import itertools

import pytest

from app.services.permissions import ACTIONS, PERMISSIONS, Action, Role, allowed_roles, can

Y, N = True, False

# Written out from PLAN.md section 4 independently of the implementation.
# Columns: owner, admin, member, viewer.
# fmt: off
EXPECTED: dict[Action, tuple[bool, bool, bool, bool]] = {
    "workspace.view":     (Y, Y, Y, Y),
    "task.write":         (Y, Y, Y, N),
    "comment.create":     (Y, Y, Y, N),
    "comment.edit_own":   (Y, Y, Y, N),
    "comment.delete_any": (Y, Y, N, N),
    "task.delete":        (Y, Y, N, N),
    "project.manage":     (Y, Y, N, N),
    "member.manage":      (Y, Y, N, N),
    "member.promote":     (Y, N, N, N),
    "workspace.manage":   (Y, N, N, N),
}
# fmt: on
COLUMNS = (Role.OWNER, Role.ADMIN, Role.MEMBER, Role.VIEWER)

MATRIX_CASES = [
    pytest.param(role, action, row[column], id=f"{role.value}-{action}")
    for action, row in EXPECTED.items()
    for column, role in enumerate(COLUMNS)
]


@pytest.mark.parametrize(("role", "action", "allowed"), MATRIX_CASES)
def test_can_matches_the_matrix(role: Role, action: Action, allowed: bool) -> None:
    assert can(role, action) is allowed


def test_matrix_covers_every_action_and_nothing_else() -> None:
    assert len(MATRIX_CASES) == len(Role) * len(ACTIONS) == 40
    assert set(ACTIONS) == set(EXPECTED) == set(PERMISSIONS)
    assert len(ACTIONS) == len(set(ACTIONS))


def test_roles_in_display_order_with_decreasing_rank() -> None:
    assert [role.value for role in Role] == ["owner", "admin", "member", "viewer"]
    assert [role.rank for role in Role] == [3, 2, 1, 0]


@pytest.mark.parametrize("action", ACTIONS)
def test_higher_roles_can_do_everything_lower_roles_can(action: Action) -> None:
    for higher, lower in itertools.combinations(Role, 2):
        assert higher.rank > lower.rank
        if can(lower, action):
            assert can(higher, action), f"{lower} can {action} but {higher} cannot"


@pytest.mark.parametrize(
    ("action", "roles"),
    [
        ("workspace.view", [Role.OWNER, Role.ADMIN, Role.MEMBER, Role.VIEWER]),
        ("task.write", [Role.OWNER, Role.ADMIN, Role.MEMBER]),
        ("member.manage", [Role.OWNER, Role.ADMIN]),
        ("workspace.manage", [Role.OWNER]),
    ],
)
def test_allowed_roles_lists_most_powerful_first(action: Action, roles: list[Role]) -> None:
    assert allowed_roles(action) == roles
