"""The sliding-window limiter behind the auth rate limits. No database needed."""

import pytest
from pydantic import SecretStr

from app.core.config import Settings
from app.core.errors import RateLimited
from app.core.rate_limit import AuthRateLimiter, SlidingWindowRateLimiter


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


def test_allows_up_to_the_limit_then_rejects(clock: FakeClock) -> None:
    limiter = SlidingWindowRateLimiter(3, 60, clock=clock)

    assert [limiter.hit("k") for _ in range(3)] == [None, None, None]
    assert limiter.hit("k") == 60


def test_retry_after_counts_down_to_when_the_oldest_hit_leaves_the_window(
    clock: FakeClock,
) -> None:
    limiter = SlidingWindowRateLimiter(2, 60, clock=clock)
    limiter.hit("k")
    clock.now += 10
    limiter.hit("k")

    clock.now += 15.5
    assert limiter.hit("k") == 35  # ceil(60 - 25.5)
    clock.now += 34.4
    assert limiter.hit("k") == 1  # 0.1 s left, rounded up
    clock.now += 0.1
    assert limiter.hit("k") is None


def test_window_slides(clock: FakeClock) -> None:
    limiter = SlidingWindowRateLimiter(2, 60, clock=clock)
    limiter.hit("k")
    clock.now += 30
    limiter.hit("k")

    clock.now += 30  # the first hit is now exactly one window old
    assert limiter.hit("k") is None
    assert limiter.hit("k") == 30


def test_rejected_hits_are_not_counted(clock: FakeClock) -> None:
    limiter = SlidingWindowRateLimiter(1, 60, clock=clock)
    limiter.hit("k")
    for _ in range(10):
        clock.now += 5
        assert limiter.hit("k") is not None

    clock.now += 10
    assert limiter.hit("k") is None


def test_keys_are_independent(clock: FakeClock) -> None:
    limiter = SlidingWindowRateLimiter(1, 60, clock=clock)

    assert limiter.hit("a") is None
    assert limiter.hit("b") is None
    assert limiter.hit("a") == 60


def test_reset_forgets_every_hit(clock: FakeClock) -> None:
    limiter = SlidingWindowRateLimiter(1, 60, clock=clock)
    limiter.hit("k")

    limiter.reset()

    assert limiter.hit("k") is None


def test_limit_must_be_positive() -> None:
    with pytest.raises(ValueError, match="at least 1"):
        SlidingWindowRateLimiter(0)


def settings(per_ip: int, per_email: int) -> Settings:
    return Settings(
        database_url="postgresql+psycopg://user@localhost/db",
        jwt_secret=SecretStr("secret"),
        auth_rate_limit_per_minute=per_ip,
        auth_rate_limit_per_email_per_minute=per_email,
    )


def test_defaults_are_twenty_per_ip_and_ten_per_email() -> None:
    defaults = Settings.model_fields

    assert defaults["auth_rate_limit_per_minute"].default == 20
    assert defaults["auth_rate_limit_per_email_per_minute"].default == 10


def test_zero_turns_a_limit_off() -> None:
    limiter = AuthRateLimiter.from_settings(settings(0, 0))

    assert limiter.per_ip is None
    assert limiter.per_email is None
    for _ in range(100):
        limiter.check_ip("login", "1.2.3.4")
        limiter.check_login_email("1.2.3.4", "a@example.com")


def test_ip_limit_is_per_endpoint_and_ip() -> None:
    limiter = AuthRateLimiter.from_settings(settings(1, 0))
    limiter.check_ip("login", "1.2.3.4")
    limiter.check_ip("register", "1.2.3.4")
    limiter.check_ip("login", "5.6.7.8")

    with pytest.raises(RateLimited) as excinfo:
        limiter.check_ip("login", "1.2.3.4")
    assert excinfo.value.headers == {"Retry-After": "60"}


def test_email_limit_is_per_ip_and_email() -> None:
    limiter = AuthRateLimiter.from_settings(settings(0, 1))
    limiter.check_login_email("1.2.3.4", "a@example.com")
    limiter.check_login_email("1.2.3.4", "b@example.com")
    limiter.check_login_email("5.6.7.8", "a@example.com")

    with pytest.raises(RateLimited):
        limiter.check_login_email("1.2.3.4", "a@example.com")


@pytest.mark.parametrize(
    ("retry_after", "message", "header"),
    [
        (1, "Too many attempts. Try again in 1 second.", "1"),
        (42, "Too many attempts. Try again in 42 seconds.", "42"),
        (0, "Too many attempts. Try again in 1 second.", "1"),
    ],
)
def test_rate_limited_error(retry_after: int, message: str, header: str) -> None:
    error = RateLimited(retry_after)

    assert (error.status_code, error.code) == (429, "rate_limited")
    assert error.message == message
    assert error.details == {}
    assert error.headers == {"Retry-After": header}
