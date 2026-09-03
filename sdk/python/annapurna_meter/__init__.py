"""Annapurna metering hook (Python).

A thin, fail-safe wrapper that reports per-call LLM usage to Annapurna so spend
can be attributed per feature. It captures tokens_in, tokens_out, model and a
feature_id and posts them to the hook-ingest endpoint. Cost is computed server
side from Annapurna's pricing tables — the SDK never sees prices.

Design principles:
  * **Never break the caller.** Reporting happens on a background thread and all
    errors are swallowed. If Annapurna is down or misconfigured, your app is fine.
  * **Tiny footprint.** Standard library only.
  * **Optional.** With no ingest URL/token configured, every call is a no-op, so
    the same code runs whether or not the hook is enabled.

Configuration (constructor args or environment):
  ANNAPURNA_INGEST_URL    e.g. https://app.annapurna.example/api/hook/events
  ANNAPURNA_INGEST_TOKEN  the per-tenant ingest token from the dashboard
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time
import urllib.request
from collections import OrderedDict
from typing import Any, Optional

__version__ = "0.3.1"


class Meter:
    def __init__(
        self,
        feature_id: Optional[str] = None,
        *,
        ingest_url: Optional[str] = None,
        token: Optional[str] = None,
        timeout: float = 5.0,
        metadata: Optional[dict] = None,
        optimize: bool = False,
        prefix_chars: int = 2000,
        flush_interval: float = 60.0,
        salt: Optional[str] = None,
        transport: Optional[Any] = None,
    ):
        self.feature_id = feature_id
        self.ingest_url = ingest_url or os.environ.get("ANNAPURNA_INGEST_URL")
        self.token = token or os.environ.get("ANNAPURNA_INGEST_TOKEN")
        self.timeout = timeout
        # Default tags applied to every event (e.g. environment). Per-call
        # metadata is merged on top. Optional — omit for the simplest setup.
        self.metadata = dict(metadata) if metadata else {}
        # transport(url, headers, body) -> None lets tests capture posts.
        self._transport = transport
        # Optimize mode (opt spec §4): measure traffic SHAPE — salted-hash
        # fingerprints and counts, never prompt text — to find duplicate calls
        # and uncached repeated prefixes. Off by default; all work is off the
        # call path, bounded, and fail-safe.
        self._salt = salt
        self._optimizer = (
            _Optimizer(self, prefix_chars=prefix_chars, flush_interval=flush_interval)
            if optimize
            else None
        )

    @property
    def enabled(self) -> bool:
        return bool(self.ingest_url and self.token)

    def record(
        self,
        *,
        provider: str,
        model: str,
        tokens_in: int,
        tokens_out: int,
        feature_id: Optional[str] = None,
        occurred_at: Optional[str] = None,
        latency_ms: Optional[int] = None,
        metadata: Optional[dict] = None,
    ) -> Optional[threading.Thread]:
        """Report a single metered call. Returns the background thread (or None)."""
        event = {
            "provider": provider,
            "model": model,
            "tokens_in": int(tokens_in or 0),
            "tokens_out": int(tokens_out or 0),
            "feature_id": feature_id or self.feature_id,
        }
        if occurred_at:
            event["occurred_at"] = occurred_at
        if latency_ms is not None:
            event["latency_ms"] = int(latency_ms)
        merged = {**self.metadata, **(metadata or {})}
        if merged:
            event["metadata"] = merged
        return self._send([event])

    def record_anthropic(
        self,
        response: Any,
        *,
        feature_id: Optional[str] = None,
        model: Optional[str] = None,
        latency_ms: Optional[int] = None,
        metadata: Optional[dict] = None,
    ) -> Optional[threading.Thread]:
        """Record from an Anthropic Messages response (usage.input_tokens/output_tokens)."""
        tin, tout = _usage(response, ("input_tokens", "output_tokens"))
        return self.record(
            provider="anthropic",
            model=model or _attr(response, "model", ""),
            tokens_in=tin,
            tokens_out=tout,
            feature_id=feature_id,
            latency_ms=latency_ms,
            metadata=metadata,
        )

    def record_openai(
        self,
        response: Any,
        *,
        feature_id: Optional[str] = None,
        model: Optional[str] = None,
        latency_ms: Optional[int] = None,
        metadata: Optional[dict] = None,
    ) -> Optional[threading.Thread]:
        """Record from an OpenAI response (usage.prompt_tokens/completion_tokens)."""
        tin, tout = _usage(response, ("prompt_tokens", "completion_tokens"))
        return self.record(
            provider="openai",
            model=model or _attr(response, "model", ""),
            tokens_in=tin,
            tokens_out=tout,
            feature_id=feature_id,
            latency_ms=latency_ms,
            metadata=metadata,
        )

    def record_gemini(
        self,
        response: Any,
        *,
        feature_id: Optional[str] = None,
        model: Optional[str] = None,
        latency_ms: Optional[int] = None,
        metadata: Optional[dict] = None,
    ) -> Optional[threading.Thread]:
        """Record from a Google Gemini response (usage_metadata token counts)."""
        usage = _attr(response, "usage_metadata", {}) or {}
        tin = int(_attr(usage, "prompt_token_count", 0) or 0)
        tout = int(_attr(usage, "candidates_token_count", 0) or 0)
        return self.record(
            provider="google",
            model=model or _attr(response, "model_version", "") or _attr(response, "model", ""),
            tokens_in=tin,
            tokens_out=tout,
            feature_id=feature_id,
            latency_ms=latency_ms,
            metadata=metadata,
        )

    def record_openai_compatible(
        self,
        response: Any,
        *,
        provider: str,
        feature_id: Optional[str] = None,
        model: Optional[str] = None,
        latency_ms: Optional[int] = None,
        metadata: Optional[dict] = None,
    ) -> Optional[threading.Thread]:
        """Record from any OpenAI-compatible response (hosted open-source models).

        Together, Fireworks, Groq, OpenRouter, DeepInfra, etc. all return the
        OpenAI usage shape (prompt_tokens/completion_tokens). Pass the provider
        name so Annapurna prices it against that host's rates.
        """
        tin, tout = _usage(response, ("prompt_tokens", "completion_tokens"))
        return self.record(
            provider=provider,
            model=model or _attr(response, "model", ""),
            tokens_in=tin,
            tokens_out=tout,
            feature_id=feature_id,
            latency_ms=latency_ms,
            metadata=metadata,
        )

    def _send(self, events: list) -> Optional[threading.Thread]:
        if not self.enabled:
            return None  # not configured -> no-op
        return _spawn(lambda: self._post_sync(events))

    def _post_sync(self, events: list) -> None:
        """POST events on the CURRENT thread. Callers run this off the request path."""
        if not self.enabled or not events:
            return
        body = json.dumps({"events": events}).encode("utf-8")
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }
        try:
            if self._transport is not None:
                self._transport(self.ingest_url, headers, body)
                return
            req = urllib.request.Request(self.ingest_url, data=body, headers=headers, method="POST")
            urllib.request.urlopen(req, timeout=self.timeout).read()
        except Exception:
            pass  # metering must never raise into the caller's request path

    def _salt_url(self) -> Optional[str]:
        if not self.ingest_url:
            return None
        if self.ingest_url.endswith("/events"):
            return self.ingest_url[: -len("/events")] + "/salt"
        return self.ingest_url.rstrip("/") + "/salt"

    def _fetch_salt(self) -> Optional[str]:
        """Fetch (once) the per-tenant fingerprint salt. Fail-safe -> None."""
        if self._salt is not None:
            return self._salt
        if not self.enabled:
            return None
        try:
            url = self._salt_url()
            req = urllib.request.Request(
                url, headers={"Authorization": f"Bearer {self.token}"}, method="GET"
            )
            data = urllib.request.urlopen(req, timeout=self.timeout).read()
            self._salt = json.loads(data).get("salt")
        except Exception:
            self._salt = None
        return self._salt

    def _record_wrapped(
        self, provider: str, request: dict, response: Any, latency_ms: int
    ) -> Optional[threading.Thread]:
        """Record an auto-instrumented (wrap()) call — all work off the call path.

        Token extraction, optimize-mode hashing and the POST all run on the
        background thread, so the caller's request never pays for them.
        """
        if not self.enabled:
            return None

        def _work() -> None:
            try:
                model, tokens_in, tokens_out, cache_read = _extract_usage(provider, response)
                event = {
                    "provider": provider,
                    "model": model,
                    "tokens_in": int(tokens_in or 0),
                    "tokens_out": int(tokens_out or 0),
                    "feature_id": self.feature_id,
                    "latency_ms": int(latency_ms),
                }
                if self.metadata:
                    event["metadata"] = dict(self.metadata)
                extra: list = []
                if self._optimizer is not None:
                    signal = self._optimizer.on_call(
                        provider, model, request, tokens_in, tokens_out, cache_read
                    )
                    if signal:
                        event["signal"] = signal
                    extra = self._optimizer.due_summaries()
                self._post_sync([event, *extra])
            except Exception:
                pass  # metering must never raise into the caller

        return _spawn(_work)


def _spawn(work) -> Optional[threading.Thread]:
    """Run `work` on a daemon thread, or give up quietly if one can't be started.

    Thread creation is itself a failure point: an application already at its
    thread limit — which metering, at one thread per call, helps it reach — makes
    Thread.start() raise RuntimeError. Unguarded, that propagated out of
    Meter.record() and into the caller's request path, so the SDK could break the
    very application it promises never to affect. Losing a metering event is the
    correct trade against raising here; the bill stays right either way, because
    reconciliation routes anything the hook misses to Unattributed.
    """
    try:
        thread = threading.Thread(target=work, daemon=True)
        thread.start()
        return thread
    except Exception:
        return None


def _attr(obj: Any, name: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def _usage(response: Any, keys: tuple) -> tuple:
    usage = _attr(response, "usage", {}) or {}
    return int(_attr(usage, keys[0], 0) or 0), int(_attr(usage, keys[1], 0) or 0)


# --------------------------------------------------------------------------
# wrap() — auto-instrument a provider client (zero code at the call sites)
# --------------------------------------------------------------------------
# The completion method path per provider, and the recorder that reads its
# response shape. Only these exact paths are instrumented; every other attribute
# passes straight through to the real client untouched.
_COMPLETION_PATHS = {
    "anthropic": {("messages", "create")},
    "openai": {("chat", "completions", "create"), ("responses", "create")},
    "google": {("models", "generate_content")},
}


def _extract_usage(provider: str, resp: Any) -> tuple:
    """Pull (model, tokens_in, tokens_out, cache_read) from a provider response.

    cache_read is True when the provider served input tokens from its prompt
    cache — used by optimize mode to not recommend caching what's already cached.
    """
    if provider == "anthropic":
        usage = _attr(resp, "usage", {}) or {}
        tin = int(_attr(usage, "input_tokens", 0) or 0)
        tout = int(_attr(usage, "output_tokens", 0) or 0)
        cache_read = int(_attr(usage, "cache_read_input_tokens", 0) or 0) > 0
        return _attr(resp, "model", ""), tin, tout, cache_read
    if provider == "google":
        usage = _attr(resp, "usage_metadata", {}) or {}
        tin = int(_attr(usage, "prompt_token_count", 0) or 0)
        tout = int(_attr(usage, "candidates_token_count", 0) or 0)
        cache_read = int(_attr(usage, "cached_content_token_count", 0) or 0) > 0
        model = _attr(resp, "model_version", "") or _attr(resp, "model", "")
        return model, tin, tout, cache_read
    # openai and OpenAI-compatible hosts
    usage = _attr(resp, "usage", {}) or {}
    tin = int(_attr(usage, "prompt_tokens", 0) or 0)
    tout = int(_attr(usage, "completion_tokens", 0) or 0)
    details = _attr(usage, "prompt_tokens_details", {}) or {}
    cache_read = int(_attr(details, "cached_tokens", 0) or 0) > 0
    return _attr(resp, "model", ""), tin, tout, cache_read


def _detect_provider(client: Any) -> str:
    module = (type(client).__module__ or "").lower()
    root = module.split(".")[0]
    if root.startswith("anthropic"):
        return "anthropic"
    if root.startswith("openai"):
        return "openai"
    if root in ("google", "genai") or "genai" in module or "generativeai" in module:
        return "google"
    raise ValueError("Could not detect the LLM provider from the client; pass provider= to wrap().")


def _has_usage(resp: Any) -> bool:
    """Only concrete responses carry usage; streams/awaitables don't -> skip them."""
    return bool(_attr(resp, "usage") or _attr(resp, "usage_metadata"))


class _Wrapped:
    """Transparent proxy that records the provider's completion call, then returns
    the real response unchanged. Anything off the instrumented path is handed back
    as-is, so the wrapped client behaves exactly like the original."""

    def __init__(self, target: Any, meter: Meter, provider: str, path: tuple = ()):
        object.__setattr__(self, "_t", target)
        object.__setattr__(self, "_m", meter)
        object.__setattr__(self, "_p", provider)
        object.__setattr__(self, "_path", path)

    def __getattr__(self, name: str) -> Any:
        attr = getattr(self._t, name)
        new_path = self._path + (name,)
        paths = _COMPLETION_PATHS.get(self._p, set())
        # Keep wrapping only while we're still on a prefix of a completion path.
        if any(p[: len(new_path)] == new_path for p in paths):
            return _Wrapped(attr, self._m, self._p, new_path)
        return attr

    def __setattr__(self, name: str, value: Any) -> None:
        setattr(self._t, name, value)

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        if self._path not in _COMPLETION_PATHS.get(self._p, set()):
            return self._t(*args, **kwargs)
        start = time.perf_counter()
        resp = self._t(*args, **kwargs)
        latency_ms = int((time.perf_counter() - start) * 1000)
        try:
            if _has_usage(resp):  # concrete response; streams/coroutines skipped
                # kwargs carry the request (messages/system/tools) optimize mode
                # fingerprints; all recording work happens off the call path.
                self._m._record_wrapped(self._p, kwargs, resp, latency_ms)
        except Exception:
            pass  # metering must never raise into the caller
        return resp


def wrap(
    client: Any,
    *,
    feature_id: Optional[str] = None,
    provider: Optional[str] = None,
    metadata: Optional[dict] = None,
    ingest_url: Optional[str] = None,
    token: Optional[str] = None,
    meter: Optional[Meter] = None,
) -> Any:
    """Wrap an LLM client so every completion call is metered automatically.

    Returns a drop-in proxy: your existing calls (``client.messages.create(...)``,
    ``client.chat.completions.create(...)``) are unchanged, and each is recorded
    with its latency after it returns. Non-completion attributes pass through, and
    streaming/async responses are skipped (use ``Meter.record_*`` for those).

    Provider is auto-detected from the client; pass ``provider=`` to override. If
    you pass your own ``meter=``, it is used as-is (configure ``feature_id`` /
    ``metadata`` on that meter).
    """
    m = meter or Meter(feature_id=feature_id, ingest_url=ingest_url, token=token, metadata=metadata)
    return _Wrapped(client, m, provider or _detect_provider(client))


# --------------------------------------------------------------------------
# Optimize mode — measured optimization signals (opt spec §4). Traffic SHAPE
# only: salted-hash fingerprints and counts, never prompt or response text.
# --------------------------------------------------------------------------
def _sha(*parts: str) -> str:
    h = hashlib.sha256()
    h.update("\x1f".join(parts).encode("utf-8"))
    return h.hexdigest()


def _normalize(request: dict) -> str:
    """Stable string for the request body (the parts that make calls identical)."""
    if not isinstance(request, dict):
        return ""
    payload = request.get("messages")
    if payload is None:
        payload = request.get("input")  # OpenAI Responses API
    if payload is None:
        payload = request.get("contents")  # Google generate_content
    try:
        return json.dumps(payload, sort_keys=True, default=str)
    except Exception:
        return str(payload)


def _static_prefix(request: dict, prefix_chars: int) -> tuple:
    """The cacheable static part of a request + a representative token estimate.

    Prefer the explicit static blocks (system prompt + tool defs); otherwise fall
    back to the leading slice of the normalized request. Tokens are estimated at
    ~4 chars/token (opt spec §4) — we can't isolate the prefix's real token count.
    """
    static = ""
    if isinstance(request, dict):
        system = request.get("system")
        tools = request.get("tools")
        if system is not None or tools is not None:
            try:
                static = json.dumps([system, tools], sort_keys=True, default=str)
            except Exception:
                static = f"{system}{tools}"
    if not static:
        static = _normalize(request)[:prefix_chars]
    return static, max(0, len(static) // 4)


class _Optimizer:
    """Client-side, bounded, thread-safe signal collector (opt spec §4.1).

    - A duplicate LRU (request_fp -> recency): a repeat within the window emits a
      one-off 'duplicate' signal that rides on the metered call.
    - A prefix counter map (prefix_fp -> counts) flushed as 'prefix' summaries on
      a timer or at capacity, so only bounded aggregates ever leave the process.
    """

    def __init__(
        self,
        meter: Meter,
        *,
        prefix_chars: int = 2000,
        flush_interval: float = 60.0,
        dup_capacity: int = 5000,
        prefix_capacity: int = 512,
    ):
        self._m = meter
        self._prefix_chars = prefix_chars
        self._flush_interval = flush_interval
        self._dup_capacity = dup_capacity
        self._prefix_capacity = prefix_capacity
        self._salt: Optional[str] = None
        self._salt_ready = False
        self._seen: OrderedDict[str, None] = OrderedDict()
        self._prefixes: dict = {}
        self._last_flush = time.monotonic()
        self._lock = threading.Lock()

    def _get_salt(self) -> Optional[str]:
        if not self._salt_ready:
            self._salt = self._m._fetch_salt()
            self._salt_ready = True
        return self._salt

    def on_call(
        self,
        provider: str,
        model: str,
        request: dict,
        tokens_in: int,
        tokens_out: int,
        cache_read: bool,
    ) -> Optional[dict]:
        """Fold one call into the collector; return a 'duplicate' signal if it repeats."""
        salt = self._get_salt()
        if not salt:
            return None  # no salt -> no signals (never emit unsalted hashes)
        req_fp = _sha(salt, provider, model, _normalize(request))
        static, prefix_tokens = _static_prefix(request, self._prefix_chars)
        prefix_fp = _sha(salt, provider, model, static)
        with self._lock:
            duplicate = req_fp in self._seen
            if duplicate:
                self._seen.move_to_end(req_fp)
            else:
                self._seen[req_fp] = None
                while len(self._seen) > self._dup_capacity:
                    self._seen.popitem(last=False)
            entry = self._prefixes.setdefault(
                prefix_fp,
                {
                    "provider": provider,
                    "model": model,
                    "count": 0,
                    "prefix_tokens": prefix_tokens,
                    "cached": 0,
                    "tin": 0,
                    "tout": 0,
                },
            )
            entry["count"] += 1
            entry["tin"] += int(tokens_in or 0)
            entry["tout"] += int(tokens_out or 0)
            entry["prefix_tokens"] = max(entry["prefix_tokens"], prefix_tokens)
            if cache_read:
                entry["cached"] += 1
        if duplicate:
            return {"kind": "duplicate", "fingerprint": req_fp, "count": 1}
        return None

    def due_summaries(self) -> list:
        """Flush prefix counters as events when the timer elapses or the map is full."""
        now = time.monotonic()
        with self._lock:
            if now - self._last_flush < self._flush_interval and (
                len(self._prefixes) < self._prefix_capacity
            ):
                return []
            self._last_flush = now
            items, self._prefixes = self._prefixes, {}
        events = []
        for fingerprint, entry in items.items():
            events.append(
                {
                    "provider": entry["provider"],
                    "model": entry["model"],
                    "feature_id": self._m.feature_id,
                    "signal": {
                        "kind": "prefix",
                        "fingerprint": fingerprint,
                        "count": entry["count"],
                        "prefix_tokens": entry["prefix_tokens"],
                        "cached_count": entry["cached"],
                        "tokens_in": entry["tin"],
                        "tokens_out": entry["tout"],
                    },
                }
            )
        return events
