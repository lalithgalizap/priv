"""Async-safe execution helpers.

Three concerns this module addresses:

1. **Bounded DB threadpool.** psycopg2 calls block. We run them in a
   dedicated ThreadPoolExecutor with a hard upper bound on parallelism so
   a request burst can't exhaust the global default executor (and starve
   things like file parsing). The semaphore is the actual concurrency cap;
   the executor's worker count is its ceiling.

2. **Bounded file-parsing pool.** PDF / DOCX parsers can hold tens of MB
   per concurrent call. A separate, smaller pool prevents OOM during burst
   uploads.

3. **JWKS fetch via httpx.AsyncClient.** Replaces the blocking
   ``urllib.request.urlopen`` so the FastAPI event loop stays free during
   token verification on cold caches.
"""

from __future__ import annotations

import asyncio
import os
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Awaitable, Callable, TypeVar

import httpx

T = TypeVar("T")

# Worker counts are headroom; semaphores are the real concurrency cap.
DB_WORKERS = int(os.getenv("DB_THREADPOOL_SIZE", "32"))
DB_CONCURRENCY = int(os.getenv("DB_CONCURRENCY", "20"))
FILE_WORKERS = int(os.getenv("FILE_THREADPOOL_SIZE", "8"))
FILE_CONCURRENCY = int(os.getenv("FILE_CONCURRENCY", "4"))

_db_executor: ThreadPoolExecutor | None = None
_file_executor: ThreadPoolExecutor | None = None
_db_sem: asyncio.Semaphore | None = None
_file_sem: asyncio.Semaphore | None = None
_http_client: httpx.AsyncClient | None = None


def _get_db_executor() -> ThreadPoolExecutor:
    global _db_executor
    if _db_executor is None:
        _db_executor = ThreadPoolExecutor(
            max_workers=DB_WORKERS, thread_name_prefix="db"
        )
    return _db_executor


def _get_file_executor() -> ThreadPoolExecutor:
    global _file_executor
    if _file_executor is None:
        _file_executor = ThreadPoolExecutor(
            max_workers=FILE_WORKERS, thread_name_prefix="file"
        )
    return _file_executor


def _get_db_sem() -> asyncio.Semaphore:
    """Lazy-init in the running loop. Cannot be created at import time."""
    global _db_sem
    if _db_sem is None:
        _db_sem = asyncio.Semaphore(DB_CONCURRENCY)
    return _db_sem


def _get_file_sem() -> asyncio.Semaphore:
    global _file_sem
    if _file_sem is None:
        _file_sem = asyncio.Semaphore(FILE_CONCURRENCY)
    return _file_sem


def get_http_client() -> httpx.AsyncClient:
    """Lazy singleton. Closed during FastAPI shutdown."""
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=5.0, read=10.0, write=5.0, pool=5.0),
            limits=httpx.Limits(
                max_connections=100,
                max_keepalive_connections=20,
                keepalive_expiry=30.0,
            ),
        )
    return _http_client


async def shutdown_async_io() -> None:
    """Drain executors and close the HTTP client cleanly."""
    global _db_executor, _file_executor, _http_client
    if _http_client is not None:
        await _http_client.aclose()
        _http_client = None
    if _db_executor is not None:
        _db_executor.shutdown(wait=True, cancel_futures=False)
        _db_executor = None
    if _file_executor is not None:
        _file_executor.shutdown(wait=True, cancel_futures=False)
        _file_executor = None


async def run_db(fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    """Run a blocking DB call (psycopg2) without blocking the event loop.

    Concurrency is capped by the DB_CONCURRENCY semaphore so a sudden burst
    cannot saturate the connection pool and starve every other request.
    """
    sem = _get_db_sem()
    loop = asyncio.get_running_loop()
    executor = _get_db_executor()

    async with sem:
        if kwargs:
            from functools import partial
            call: Awaitable[T] = loop.run_in_executor(
                executor, partial(fn, *args, **kwargs)
            )
        else:
            call = loop.run_in_executor(executor, fn, *args)
        return await call


async def run_file(fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
    """Run a blocking file-parser (PDF/DOCX/etc.) under a tighter cap."""
    sem = _get_file_sem()
    loop = asyncio.get_running_loop()
    executor = _get_file_executor()

    async with sem:
        if kwargs:
            from functools import partial
            return await loop.run_in_executor(
                executor, partial(fn, *args, **kwargs)
            )
        return await loop.run_in_executor(executor, fn, *args)
