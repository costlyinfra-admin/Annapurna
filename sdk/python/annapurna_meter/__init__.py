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

import json
import os
import threading
import time
import urllib.request
from typing import Any, Optional

__version__ = "0.2.0"


class Meter:
    def __init__(
        self,
        feature_id: Optional[str] = None,
        *,
        ingest_url: Optional[str] = None,
        token: Optional[str] = None,
        timeout: float = 5.0,
        metadata: Optional[dict] = None,
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
        body = json.dumps({"events": events}).encode("utf-8")
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

        def _post() -> None:
            try:
                if self._transport is not None:
                    self._transport(self.ingest_url, headers, body)
                    return
                req = urllib.request.Request(
                    self.ingest_url, data=body, headers=headers, method="POST"
                )
                urllib.request.urlopen(req, timeout=self.timeout).read()
            except Exception:
                pass  # metering must never raise into the caller's request path

        thread = threading.Thread(target=_post, daemon=True)
        thread.start()
        return thread


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
_RECORDERS = {
    "anthropic": lambda m, r, lat: m.record_anthropic(r, latency_ms=lat),
    "openai": lambda m, r, lat: m.record_openai(r, latency_ms=lat),
    "google": lambda m, r, lat: m.record_gemini(r, latency_ms=lat),
}


def _detect_provider(client: Any) -> str:
    module = (type(client).__module__ or "").lower()
    root = module.split(".")[0]
    if root.startswith("anthropic"):
        return "anthropic"
    if root.startswith("openai"):
        return "openai"
    if root in ("google", "genai") or "genai" in module or "generativeai" in module:
        return "google"
    raise ValueError(
        "Could not detect the LLM provider from the client; pass provider= to wrap()."
    )


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
                _RECORDERS[self._p](self._m, resp, latency_ms)
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
    m = meter or Meter(
        feature_id=feature_id, ingest_url=ingest_url, token=token, metadata=metadata
    )
    return _Wrapped(client, m, provider or _detect_provider(client))
