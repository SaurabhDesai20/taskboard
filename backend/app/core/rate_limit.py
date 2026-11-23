"""In-process sliding-window rate limits for the auth endpoints (docs/api-contract.md 1.5).

The app runs as one process (PLAN.md section 1), so the hit log lives in memory: no new
dependency and no shared store. A restart forgets every count. With several worker processes
each would count on its own, so the effective limit would multiply by the number of workers.
"""

import math
import threading
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal, Self

from app.core.config import Settings
from app.core.errors import RateLimited

WINDOW_SECONDS = 60.0
# Every this many hits, forget the keys whose hits have all left the window, so the log stays
# as small as the set of recently active clients.
_SWEEP_EVERY = 1000

AuthEndpoint = Literal["login", "register"]


class SlidingWindowRateLimiter:
    """At most `limit` hits per key in any `window_seconds`, counted over a sliding log of
    hit times. Rejected hits are not recorded, so a client that waits `retry_after` seconds
    gets through. Thread-safe: sync endpoints run in a thread pool."""

    def __init__(
        self,
        limit: int,
        window_seconds: float = WINDOW_SECONDS,
        *,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if limit < 1:
            raise ValueError("limit must be at least 1")
        self.limit = limit
        self.window_seconds = window_seconds
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()
        self._hits_since_sweep = 0

    def hit(self, key: str) -> int | None:
        """Count one hit for `key`. None when it is allowed; otherwise it is not counted and
        the result is the whole seconds until a hit for `key` would be allowed (at least 1)."""
        now = self._clock()
        with self._lock:
            self._maybe_sweep(now)
            hits = self._hits.setdefault(key, deque())
            self._expire(hits, now)
            if len(hits) >= self.limit:
                return max(1, math.ceil(hits[0] + self.window_seconds - now))
            hits.append(now)
            return None

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()

    def _expire(self, hits: deque[float], now: float) -> None:
        while hits and hits[0] <= now - self.window_seconds:
            hits.popleft()

    def _maybe_sweep(self, now: float) -> None:
        self._hits_since_sweep += 1
        if self._hits_since_sweep < _SWEEP_EVERY:
            return
        self._hits_since_sweep = 0
        for key in list(self._hits):
            hits = self._hits[key]
            self._expire(hits, now)
            if not hits:
                del self._hits[key]


@dataclass(frozen=True)
class AuthRateLimiter:
    """The limits on POST /auth/login and POST /auth/register. A None limiter is off.

    - `per_ip`: requests per client IP to each endpoint, counted before the body is validated,
      so invalid requests count too.
    - `per_email`: login attempts per client IP and (normalized) email, counted after
      validation. It caps guessing one account's password well below the per-IP limit, without
      letting anyone lock a user out from another address.
    """

    per_ip: SlidingWindowRateLimiter | None
    per_email: SlidingWindowRateLimiter | None

    @classmethod
    def from_settings(cls, settings: Settings) -> Self:
        def limiter(limit: int) -> SlidingWindowRateLimiter | None:
            return SlidingWindowRateLimiter(limit) if limit > 0 else None

        return cls(
            per_ip=limiter(settings.auth_rate_limit_per_minute),
            per_email=limiter(settings.auth_rate_limit_per_email_per_minute),
        )

    def check_ip(self, endpoint: AuthEndpoint, client_ip: str) -> None:
        """Raise RateLimited (429) when `client_ip` is over its limit for `endpoint`."""
        _check(self.per_ip, f"{endpoint}|{client_ip}")

    def check_login_email(self, client_ip: str, email: str) -> None:
        """Raise RateLimited (429) when this IP is over its limit for logging in as `email`."""
        _check(self.per_email, f"{client_ip}|{email}")


def _check(limiter: SlidingWindowRateLimiter | None, key: str) -> None:
    if limiter is None:
        return
    retry_after = limiter.hit(key)
    if retry_after is not None:
        raise RateLimited(retry_after)
