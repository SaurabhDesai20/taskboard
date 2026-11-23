"""POST /tasks/{tid}/move: positions, neighbour validation and rebalancing (contract 3.6).

Positions are 1024 apart by default (factories and the API both append at last + 1024).
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from itertools import pairwise
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.project import Project
from app.models.task import Task, TaskStatus
from app.services.permissions import Role
from app.services.tasks import MIN_POSITION_GAP
from tests.api.helpers import assert_error, validation_fields
from tests.api.task_helpers import Json, get_task, list_tasks, move_task, move_url
from tests.factories import Team, create_project, create_team, log_in
from tests.factories import create_task as make_task

ARCHIVED_AT = datetime(2026, 11, 1, 12, 0, tzinfo=UTC)


@dataclass(frozen=True)
class Board:
    team: Team
    project: Project
    # todo: a (1024), b (2048), c (3072). in_review: r1 (1024), r2 (2048). done and
    # in_progress are empty.
    a: Task
    b: Task
    c: Task
    r1: Task
    r2: Task


@pytest.fixture
def board(client: TestClient, db_session: Session) -> Board:
    team = create_team(db_session)
    project = create_project(db_session, team.workspace, key="WEB")
    todo = [make_task(db_session, project, title=name) for name in ("A", "B", "C")]
    review = [
        make_task(db_session, project, title=name, status=TaskStatus.IN_REVIEW)
        for name in ("R1", "R2")
    ]
    log_in(client, team.users[Role.MEMBER])
    return Board(team, project, *todo, *review)


def column(client: TestClient, board: Board, status: str) -> list[Json]:
    return list_tasks(client, board.project.id, status=status)


def titles(tasks: list[Json]) -> list[str]:
    return [task["title"] for task in tasks]


def positions(tasks: list[Json]) -> list[float]:
    return [task["position"] for task in tasks]


def test_starting_board(client: TestClient, board: Board) -> None:
    assert [(t["title"], t["position"]) for t in column(client, board, "todo")] == [
        ("A", 1024.0),
        ("B", 2048.0),
        ("C", 3072.0),
    ]


# --- the neighbour table ----------------------------------------------------------------


def test_move_to_the_top_of_the_column(client: TestClient, board: Board) -> None:
    moved = move_task(client, board.c.id, "todo", before=board.a.id)

    assert moved["position"] == 1024.0 - 1024
    assert titles(column(client, board, "todo")) == ["C", "A", "B"]


def test_move_to_the_bottom_of_the_column(client: TestClient, board: Board) -> None:
    moved = move_task(client, board.a.id, "todo", after=board.c.id)

    assert moved["position"] == 3072.0 + 1024
    assert titles(column(client, board, "todo")) == ["B", "C", "A"]


def test_move_between_two_tasks(client: TestClient, board: Board) -> None:
    moved = move_task(client, board.c.id, "todo", after=board.a.id, before=board.b.id)

    assert moved["position"] == (1024.0 + 2048.0) / 2
    assert titles(column(client, board, "todo")) == ["A", "C", "B"]


def test_move_without_neighbours_goes_to_the_end_of_the_column(
    client: TestClient, board: Board
) -> None:
    within = move_task(client, board.a.id, "todo")
    across = move_task(client, board.b.id, "in_review")

    assert within["position"] == 3072.0 + 1024
    assert titles(column(client, board, "todo")) == ["C", "A"]
    assert across["position"] == 2048.0 + 1024
    assert titles(column(client, board, "in_review")) == ["R1", "R2", "B"]


@pytest.mark.parametrize("status", ["in_progress", "done"])
def test_move_into_an_empty_column(client: TestClient, board: Board, status: str) -> None:
    moved = move_task(client, board.b.id, status)

    assert (moved["status"], moved["position"]) == (status, 1024.0)
    assert titles(column(client, board, status)) == ["B"]
    assert titles(column(client, board, "todo")) == ["A", "C"]


def test_the_only_task_of_a_column_stays_put(client: TestClient, board: Board) -> None:
    move_task(client, board.b.id, "done")

    moved = move_task(client, board.b.id, "done")

    assert moved["position"] == 1024.0


def test_move_to_another_column_between_two_tasks(client: TestClient, board: Board) -> None:
    before = get_task(client, board.a.id)

    moved = move_task(client, board.a.id, "in_review", after=board.r1.id, before=board.r2.id)

    assert moved == before | {
        "status": "in_review",
        "position": 1536.0,
        "updated_at": moved["updated_at"],
    }
    assert titles(column(client, board, "in_review")) == ["R1", "A", "R2"]
    assert titles(column(client, board, "todo")) == ["B", "C"]


def test_move_to_the_top_and_bottom_of_another_column(client: TestClient, board: Board) -> None:
    top = move_task(client, board.a.id, "in_review", before=board.r1.id)
    bottom = move_task(client, board.c.id, "in_review", after=board.r2.id)

    assert (top["position"], bottom["position"]) == (0.0, 3072.0)
    assert titles(column(client, board, "in_review")) == ["A", "R1", "R2", "C"]
    assert titles(column(client, board, "todo")) == ["B"]


def test_whole_board_order_after_several_moves(client: TestClient, board: Board) -> None:
    move_task(client, board.r2.id, "todo", before=board.a.id)
    move_task(client, board.b.id, "done")
    move_task(client, board.a.id, "in_progress")
    move_task(client, board.c.id, "todo", before=board.r2.id)

    board_order = [(t["status"], t["title"]) for t in list_tasks(client, board.project.id)]
    assert board_order == [
        ("todo", "C"),
        ("todo", "R2"),
        ("in_progress", "A"),
        ("in_review", "R1"),
        ("done", "B"),
    ]


# --- neighbours that are out of date ----------------------------------------------------


def test_after_only_places_the_task_directly_after_that_neighbour(
    client: TestClient, board: Board
) -> None:
    """The client thinks A is last, but B and C follow it: no position is shared with B."""
    moved = move_task(client, board.r1.id, "todo", after=board.a.id)

    assert moved["position"] == 1536.0
    assert titles(column(client, board, "todo")) == ["A", "R1", "B", "C"]


def test_before_only_places_the_task_directly_before_that_neighbour(
    client: TestClient, board: Board
) -> None:
    moved = move_task(client, board.r1.id, "todo", before=board.c.id)

    assert moved["position"] == 2560.0
    assert titles(column(client, board, "todo")) == ["A", "B", "R1", "C"]


def test_non_adjacent_neighbours_place_the_task_directly_after_the_first(
    client: TestClient, board: Board
) -> None:
    moved = move_task(client, board.r1.id, "todo", after=board.a.id, before=board.c.id)

    assert moved["position"] == 1536.0
    assert titles(column(client, board, "todo")) == ["A", "R1", "B", "C"]


# --- validation -------------------------------------------------------------------------

INVALID_NEIGHBOUR = "Must be another task of this project with the target status"
OUT_OF_ORDER = "Must come after after_task_id in the target column"


def neighbour_errors(response: Any) -> list[tuple[str, str]]:
    assert_error(response, 422, "validation_error")
    return [(e["field"], e["message"]) for e in response.json()["error"]["details"]["errors"]]


def snapshot(client: TestClient, board: Board) -> list[Json]:
    return list_tasks(client, board.project.id)


@pytest.mark.parametrize("field", ["after_task_id", "before_task_id"])
def test_neighbour_in_another_column_is_rejected(
    client: TestClient, board: Board, field: str
) -> None:
    before = snapshot(client, board)

    response = client.post(move_url(board.a.id), json={"status": "todo", field: str(board.r1.id)})

    assert neighbour_errors(response) == [(field, INVALID_NEIGHBOUR)]
    assert snapshot(client, board) == before


@pytest.mark.parametrize("field", ["after_task_id", "before_task_id"])
def test_neighbour_in_another_project_is_rejected(
    client: TestClient, db_session: Session, board: Board, field: str
) -> None:
    other_project = make_task(db_session, create_project(db_session, board.team.workspace))
    other_workspace = make_task(
        db_session, create_project(db_session, create_team(db_session).workspace)
    )
    before = snapshot(client, board)

    for foreign in (other_project, other_workspace):
        response = client.post(
            move_url(board.a.id), json={"status": "todo", field: str(foreign.id)}
        )

        assert neighbour_errors(response) == [(field, INVALID_NEIGHBOUR)]
    assert snapshot(client, board) == before


@pytest.mark.parametrize("field", ["after_task_id", "before_task_id"])
def test_unknown_neighbour_is_rejected(client: TestClient, board: Board, field: str) -> None:
    response = client.post(
        move_url(board.a.id),
        json={"status": "todo", field: "40000000-0000-4000-8000-000000000999"},
    )

    assert neighbour_errors(response) == [(field, INVALID_NEIGHBOUR)]


@pytest.mark.parametrize("field", ["after_task_id", "before_task_id"])
def test_task_cannot_be_its_own_neighbour(client: TestClient, board: Board, field: str) -> None:
    response = client.post(move_url(board.b.id), json={"status": "todo", field: str(board.b.id)})

    assert neighbour_errors(response) == [(field, INVALID_NEIGHBOUR)]


def test_both_invalid_neighbours_are_reported(client: TestClient, board: Board) -> None:
    response = client.post(
        move_url(board.a.id),
        json={
            "status": "todo",
            "after_task_id": str(board.r1.id),
            "before_task_id": str(board.a.id),
        },
    )

    assert neighbour_errors(response) == [
        ("after_task_id", INVALID_NEIGHBOUR),
        ("before_task_id", INVALID_NEIGHBOUR),
    ]


@pytest.mark.parametrize(("after", "before"), [("c", "b"), ("b", "b"), ("c", "a")])
def test_before_task_must_come_after_the_after_task(
    client: TestClient, board: Board, after: str, before: str
) -> None:
    snapshot_before = snapshot(client, board)

    response = client.post(
        move_url(board.r1.id),
        json={
            "status": "todo",
            "after_task_id": str(getattr(board, after).id),
            "before_task_id": str(getattr(board, before).id),
        },
    )

    assert neighbour_errors(response) == [("before_task_id", OUT_OF_ORDER)]
    assert snapshot(client, board) == snapshot_before


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({}, "status"),
        ({"status": None}, "status"),
        ({"status": "blocked"}, "status"),
        ({"status": "todo", "after_task_id": "not-a-uuid"}, "after_task_id"),
        ({"status": "todo", "before_task_id": 12}, "before_task_id"),
    ],
)
def test_move_rejects_an_invalid_body(
    client: TestClient, board: Board, body: Json, field: str
) -> None:
    response = client.post(move_url(board.a.id), json=body)

    assert validation_fields(response) == {(field, "body")}


def test_move_in_an_archived_project_conflicts(client: TestClient, db_session: Session) -> None:
    team = create_team(db_session)
    project = create_project(db_session, team.workspace, archived_at=ARCHIVED_AT)
    task, other = make_task(db_session, project), make_task(db_session, project)
    log_in(client, team.owner)

    for body in (
        {"status": "done"},
        {"status": "todo", "before_task_id": str(other.id)},
        # The archived check comes before neighbour validation.
        {"status": "todo", "after_task_id": str(task.id)},
    ):
        response = client.post(move_url(task.id), json=body)

        assert_error(
            response,
            409,
            "conflict",
            reason="project_archived",
            message="This project is archived, so its tasks are read-only",
        )
    assert get_task(client, task.id)["position"] == 1024.0


# --- rebalancing ------------------------------------------------------------------------


def assert_strictly_increasing(values: list[float]) -> None:
    assert all(a < b for a, b in pairwise(values)), values


@pytest.mark.parametrize("gap", [0.0, MIN_POSITION_GAP / 10, MIN_POSITION_GAP / 2])
def test_too_small_a_gap_rebalances_the_column(
    client: TestClient, db_session: Session, board: Board, gap: float
) -> None:
    """Neighbours closer than the minimum gap (or equal) get the column renumbered."""
    p = make_task(db_session, board.project, title="P", position=5000.0)
    q = make_task(db_session, board.project, title="Q", position=5000.0 + gap)
    done = make_task(db_session, board.project, title="D", status=TaskStatus.DONE, position=7.5)

    moved = move_task(client, board.r1.id, "todo", after=p.id, before=q.id)

    todo = column(client, board, "todo")
    assert [(t["title"], t["position"]) for t in todo] == [
        ("A", 1024.0),
        ("B", 2048.0),
        ("C", 3072.0),
        ("P", 4096.0),
        ("R1", 5120.0),
        ("Q", 6144.0),
    ]
    assert moved["position"] == 5120.0
    # Other columns keep their positions.
    assert [(t["id"], t["position"]) for t in column(client, board, "done")] == [
        (str(done.id), 7.5)
    ]
    assert positions(column(client, board, "in_review")) == [2048.0]


def test_a_gap_just_above_the_minimum_takes_the_midpoint(
    client: TestClient, db_session: Session, board: Board
) -> None:
    p = make_task(db_session, board.project, title="P", position=5000.0)
    q = make_task(db_session, board.project, title="Q", position=5000.0 + 4 * MIN_POSITION_GAP)

    moved = move_task(client, board.r1.id, "todo", after=p.id, before=q.id)

    assert moved["position"] == (p.position + q.position) / 2
    assert p.position < moved["position"] < q.position
    assert positions(column(client, board, "todo"))[:3] == [1024.0, 2048.0, 3072.0]


def test_rebalance_keeps_ties_in_their_listed_order(
    client: TestClient, db_session: Session, board: Board
) -> None:
    """Three tasks share a position; dropping one between the other two renumbers by the
    listed order (position, then number)."""
    for name in ("T1", "T2", "T3"):
        make_task(db_session, board.project, title=name, status=TaskStatus.DONE, position=50.0)
    done = column(client, board, "done")
    assert titles(done) == ["T1", "T2", "T3"]

    move_task(client, board.a.id, "done", after=done[1]["id"], before=done[2]["id"])

    after = column(client, board, "done")
    assert titles(after) == ["T1", "T2", "A", "T3"]
    assert positions(after) == [1024.0, 2048.0, 3072.0, 4096.0]


def test_repeated_moves_into_the_same_gap_stay_ordered(
    client: TestClient, db_session: Session, board: Board
) -> None:
    """Each move drops a new task directly after A, halving the gap every time, until the
    column is rebalanced. The order is always exactly what the client asked for."""
    incoming = [
        make_task(db_session, board.project, title=f"N{n}", status=TaskStatus.DONE)
        for n in range(40)
    ]
    expected = ["A", "B", "C"]
    rebalanced = False

    for task in incoming:
        todo = column(client, board, "todo")
        move_task(client, task.id, "todo", after=board.a.id, before=todo[1]["id"])

        expected.insert(1, task.title)
        todo = column(client, board, "todo")
        assert titles(todo) == expected
        assert_strictly_increasing(positions(todo))
        rebalanced = rebalanced or todo[-1]["position"] != 3072.0

    assert rebalanced, "40 halvings of a 1024 gap must have triggered a rebalance"
    final = positions(column(client, board, "todo"))
    assert all(b - a >= MIN_POSITION_GAP for a, b in pairwise(final))
