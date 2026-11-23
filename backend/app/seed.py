"""Demo data for a fresh database: python -m app.seed (from backend/).

Writes to the database at DATABASE_URL, so point it at a database meant for demo data. It
refuses to run with APP_ENV=production.

What it creates (backend/README.md lists the logins):
- five users who share DEMO_PASSWORD, one per role plus a second member;
- the workspace "Acme" (slug `acme`) with all of them as members;
- projects "Website" (WEB) and "Mobile App" (MOB), and "Launch 2025" (L25), which is archived;
- tasks in every column, with assignees, priorities and due dates relative to today (some
  overdue), and comments.

Everything goes through the services, as the API would, so permissions are checked and every
change has its activity entry.

Idempotent: it only creates what is missing, matched by natural key (email, workspace slug,
project key, task title within its project), and never changes or deletes existing data. A
task's comments and follow-up move are written only with the task itself, so a re-run adds
nothing and fails on nothing.
"""

import sys
from dataclasses import dataclass, field
from datetime import date, timedelta
from uuid import UUID

from sqlalchemy import make_url
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.errors import Conflict
from app.core.logging import configure_logging
from app.db.session import get_session_factory
from app.models.task import TaskPriority, TaskStatus
from app.repositories import users as users_repo
from app.schemas.auth import RegisterRequest
from app.schemas.comment import CommentCreate
from app.schemas.member import MemberCreate
from app.schemas.project import ProjectCreate, ProjectRead
from app.schemas.task import TaskCreate, TaskFilters, TaskMoveRequest
from app.schemas.workspace import WorkspaceCreate
from app.services import access as access_service
from app.services import auth as auth_service
from app.services import comments as comments_service
from app.services import members as members_service
from app.services import projects as projects_service
from app.services import tasks as tasks_service
from app.services import workspaces as workspaces_service
from app.services.permissions import Role, can

DEMO_PASSWORD = "taskboard-demo"
WORKSPACE_NAME = "Acme"
WORKSPACE_SLUG = "acme"


@dataclass(frozen=True)
class DemoUser:
    handle: str
    email: str
    name: str
    role: Role


DEMO_USERS: tuple[DemoUser, ...] = (
    DemoUser("asha", "asha@acme.example.com", "Asha Rao", Role.OWNER),
    DemoUser("devon", "devon@acme.example.com", "Devon Hale", Role.ADMIN),
    DemoUser("ben", "ben@acme.example.com", "Ben Okafor", Role.MEMBER),
    DemoUser("maya", "maya@acme.example.com", "Maya Lin", Role.MEMBER),
    DemoUser("chen", "chen@acme.example.com", "Chen Wei", Role.VIEWER),
)
OWNER = DEMO_USERS[0]


@dataclass(frozen=True)
class TaskSpec:
    title: str
    status: TaskStatus
    priority: TaskPriority
    assignee: str | None = None
    # Days from today; negative is overdue (unless the task is done).
    due_in_days: int | None = None
    description: str | None = None
    # (author handle, body), oldest first.
    comments: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class ProjectSpec:
    key: str
    name: str
    description: str
    # Handle of the user who creates the project's tasks.
    creator: str
    tasks: tuple[TaskSpec, ...]
    archived: bool = False


_T, _P, _R, _D = TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW, TaskStatus.DONE
_LOW, _MED, _HIGH, _URG = (
    TaskPriority.LOW,
    TaskPriority.MEDIUM,
    TaskPriority.HIGH,
    TaskPriority.URGENT,
)

PROJECTS: tuple[ProjectSpec, ...] = (
    ProjectSpec(
        key="WEB",
        name="Website",
        description="Marketing site and signup flow",
        creator="asha",
        tasks=(
            TaskSpec(
                "Fix login redirect",
                _P,
                _HIGH,
                "ben",
                -2,
                "After login users land on /404 instead of the dashboard.",
                comments=(
                    ("ben", "Reproduced on Chrome and Firefox."),
                    ("asha", "Thanks! Can we ship the fix this week?"),
                    ("ben", "Yes, the patch is small. PR by tomorrow."),
                ),
            ),
            TaskSpec("Write onboarding copy", _T, _MED, "maya", 5),
            TaskSpec("Redesign pricing page", _T, _HIGH, "devon", 12),
            TaskSpec("Add cookie consent banner", _T, _LOW),
            TaskSpec(
                "Set up error tracking",
                _R,
                _MED,
                "ben",
                1,
                comments=(("devon", "PR is up and needs a second review."),),
            ),
            TaskSpec(
                "Launch newsletter signup",
                _P,
                _URG,
                "asha",
                -1,
                comments=(("maya", "The double opt-in email still has the old logo."),),
            ),
            TaskSpec("Compress hero images", _D, _LOW, "maya", -6),
            TaskSpec("Accessibility audit", _T, _MED, "chen", 20),
        ),
    ),
    ProjectSpec(
        key="MOB",
        name="Mobile App",
        description="iOS and Android clients",
        creator="devon",
        tasks=(
            TaskSpec("Push notification settings", _T, _MED, "ben", 9),
            TaskSpec(
                "Offline mode for the task list",
                _P,
                _HIGH,
                "maya",
                3,
                comments=(("maya", "Caching reads works; queued writes are next."),),
            ),
            TaskSpec(
                "Crash when rotating on Android 14",
                _R,
                _URG,
                "devon",
                -3,
                "Happens on the task detail screen only.",
                comments=(
                    ("ben", "Stack trace points at the date picker."),
                    ("devon", "Fixed in the branch, please verify on a Pixel."),
                ),
            ),
            TaskSpec("App Store screenshots", _D, _LOW, "asha"),
            TaskSpec("Dark mode", _T, _LOW),
        ),
    ),
    ProjectSpec(
        key="L25",
        name="Launch 2025",
        description="Last year's launch, kept for reference",
        creator="asha",
        archived=True,
        tasks=(
            TaskSpec("Press release", _D, _MED, "asha", -40),
            TaskSpec(
                "Launch checklist",
                _D,
                _HIGH,
                "devon",
                -35,
                comments=(("asha", "All items checked. Great work, everyone!"),),
            ),
        ),
    ),
)


class SeedError(Exception):
    """The database holds data the seed cannot build on."""


@dataclass
class SeedResult:
    """What this run created (all zero on a re-run)."""

    workspace_id: UUID | None = None
    users: int = 0
    members: int = 0
    projects: int = 0
    tasks: int = 0
    comments: int = 0
    user_ids: dict[str, UUID] = field(default_factory=dict)


def seed(db: Session, settings: Settings, *, today: date | None = None) -> SeedResult:
    """Create the demo data that is missing. Each service call commits on its own."""
    today = today or date.today()
    result = SeedResult()
    result.user_ids = {user.handle: _ensure_user(db, settings, user, result) for user in DEMO_USERS}
    owner_id = result.user_ids[OWNER.handle]
    workspace_id = _ensure_workspace(db, owner_id, result)
    result.workspace_id = workspace_id
    _ensure_members(db, workspace_id, owner_id, result)
    for spec in PROJECTS:
        _ensure_project(db, workspace_id, spec, today, result)
    return result


def _ensure_user(db: Session, settings: Settings, user: DemoUser, result: SeedResult) -> UUID:
    existing = users_repo.get_by_email(db, user.email)
    if existing is not None:
        return existing.id
    data = RegisterRequest(email=user.email, name=user.name, password=DEMO_PASSWORD)
    created = auth_service.register(db, data, settings).user
    result.users += 1
    return created.id


def _ensure_workspace(db: Session, owner_id: UUID, result: SeedResult) -> UUID:
    for workspace in workspaces_service.list_for_user(db, owner_id):
        if workspace.slug == WORKSPACE_SLUG:
            return workspace.id
    try:
        created = workspaces_service.create(
            db, owner_id, WorkspaceCreate(name=WORKSPACE_NAME, slug=WORKSPACE_SLUG)
        )
    except Conflict as exc:
        raise SeedError(
            f"The workspace slug {WORKSPACE_SLUG!r} belongs to a workspace {OWNER.email} is not "
            "a member of. Seed a fresh database."
        ) from exc
    return created.id


def _ensure_members(db: Session, workspace_id: UUID, owner_id: UUID, result: SeedResult) -> None:
    access = access_service.workspace_access(db, workspace_id, owner_id, "member.manage")
    present = {member.user_id for member in members_service.list_members(db, access)}
    for user in DEMO_USERS:
        if user.role is Role.OWNER or result.user_ids[user.handle] in present:
            continue
        members_service.add(db, access, MemberCreate(email=user.email, role=user.role))
        result.members += 1


def _ensure_project(
    db: Session, workspace_id: UUID, spec: ProjectSpec, today: date, result: SeedResult
) -> None:
    owner_id = result.user_ids[OWNER.handle]
    access = access_service.workspace_access(db, workspace_id, owner_id, "project.manage")
    by_key = {
        project.key: project
        for project in projects_service.list_projects(db, access, include_archived=True)
    }
    project: ProjectRead | None = by_key.get(spec.key)
    if project is None:
        data = ProjectCreate(name=spec.name, key=spec.key, description=spec.description)
        project = projects_service.create(db, access, data)
        result.projects += 1
    if project.archived_at is not None:
        # Archived projects are read-only; whatever they hold stays as it is.
        return
    _ensure_tasks(db, project.id, spec, today, result)
    if spec.archived:
        project_access = access_service.project_access(db, project.id, owner_id, "project.manage")
        projects_service.archive(db, project_access)


def _ensure_tasks(
    db: Session, project_id: UUID, spec: ProjectSpec, today: date, result: SeedResult
) -> None:
    creator_id = result.user_ids[spec.creator]
    access = access_service.project_access(db, project_id, creator_id, "task.write")
    titles = {task.title for task in tasks_service.list_tasks(db, access, TaskFilters())}
    for task_spec in spec.tasks:
        if task_spec.title in titles:
            continue
        _create_task(db, access, spec, task_spec, today, result)


def _create_task(
    db: Session,
    access: access_service.ProjectAccess,
    project: ProjectSpec,
    spec: TaskSpec,
    today: date,
    result: SeedResult,
) -> None:
    """Create the task in To Do, move it to its column (as the assignee when they may), then
    add its comments, so the activity feed reads like real work."""
    users = result.user_ids
    due_date = None if spec.due_in_days is None else today + timedelta(days=spec.due_in_days)
    data = TaskCreate(
        title=spec.title,
        description=spec.description,
        status=TaskStatus.TODO,
        priority=spec.priority,
        assignee_id=users[spec.assignee] if spec.assignee else None,
        due_date=due_date,
    )
    task = tasks_service.create(db, access, data)
    result.tasks += 1
    if spec.status is not TaskStatus.TODO:
        mover = spec.assignee if spec.assignee and _can_write(spec.assignee) else project.creator
        move_access = access_service.task_access(db, task.id, users[mover], "task.write")
        tasks_service.move(db, move_access, TaskMoveRequest(status=spec.status))
    for author, body in spec.comments:
        comment_access = access_service.task_access(db, task.id, users[author], "comment.create")
        comments_service.create(db, comment_access, CommentCreate(body=body))
        result.comments += 1


def _can_write(handle: str) -> bool:
    role = next(user.role for user in DEMO_USERS if user.handle == handle)
    return can(role, "task.write")


def main() -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    if settings.app_env == "production":
        sys.exit("Refusing to seed: APP_ENV=production.")
    target = make_url(settings.database_url).render_as_string(hide_password=True)
    print(f"Seeding {target}")
    with get_session_factory()() as db:
        try:
            result = seed(db, settings)
        except SeedError as exc:
            sys.exit(f"Seed failed: {exc}")
    print(
        f"Created {result.users} users, {result.members} memberships, {result.projects} "
        f"projects, {result.tasks} tasks and {result.comments} comments "
        "(existing data is kept as it is)."
    )
    print(f"Workspace {WORKSPACE_NAME!r} (/w/{WORKSPACE_SLUG}).")
    print(f"Demo logins, all with the password {DEMO_PASSWORD}:")
    for user in DEMO_USERS:
        print(f"  {user.email:<26} {user.name:<12} {user.role.value}")


if __name__ == "__main__":
    main()
