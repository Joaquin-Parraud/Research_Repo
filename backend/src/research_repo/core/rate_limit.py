"""In-memory sliding-window limiter for failed login attempts.

State lives in the process, which matches the single-worker deployment. Running several
workers would give each its own counters (a looser limit, never a stricter one).
"""

import math
import time
from collections import deque
from collections.abc import Callable, Iterable

_MAX_TRACKED_KEYS = 10_000


class LoginRateLimiter:
    def __init__(
        self,
        max_failures: int,
        window_seconds: float,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._max_failures = max_failures
        self._window = window_seconds
        self._clock = clock
        self._failures: dict[str, deque[float]] = {}

    def retry_after(self, keys: Iterable[str]) -> int | None:
        """Seconds until a blocked key frees up, or None if no key is blocked."""
        now = self._clock()
        waits = []
        for key in keys:
            attempts = self._prune(key, now)
            if len(attempts) >= self._max_failures:
                waits.append(attempts[0] + self._window - now)
        return max(1, math.ceil(max(waits))) if waits else None

    def record_failure(self, keys: Iterable[str]) -> None:
        now = self._clock()
        if len(self._failures) >= _MAX_TRACKED_KEYS:
            self._prune_all(now)
        for key in keys:
            self._failures.setdefault(key, deque()).append(now)

    def reset(self, keys: Iterable[str]) -> None:
        for key in keys:
            self._failures.pop(key, None)

    def _prune(self, key: str, now: float) -> deque[float]:
        attempts = self._failures.get(key)
        if attempts is None:
            return deque()
        while attempts and attempts[0] <= now - self._window:
            attempts.popleft()
        if not attempts:
            del self._failures[key]
        return attempts

    def _prune_all(self, now: float) -> None:
        for key in list(self._failures):
            self._prune(key, now)
        # Still full (e.g. a spray of distinct emails): forget the oldest-tracked keys.
        excess = len(self._failures) - _MAX_TRACKED_KEYS // 2
        for key in list(self._failures)[: max(0, excess)]:
            del self._failures[key]
