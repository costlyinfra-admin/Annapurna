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
import urllib.request
from typing import Any, Optional

__version__ = "0.1.0"


class Meter:
    def __init__(
        self,
        feature_id: Optional[str] = None,
        *,
        ingest_url: Optional[str] = None,
        token: Optional[str] = None,
        timeout: float = 5.0,
        transport: Optional[Any] = None,
    ):
        self.feature_id = feature_id
        self.ingest_url = ingest_url or os.environ.get("ANNAPURNA_INGEST_URL")
        self.token = token or os.environ.get("ANNAPURNA_INGEST_TOKEN")
        self.timeout = timeout
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
        return self._send([event])

    def record_anthropic(
        self, response: Any, *, feature_id: Optional[str] = None, model: Optional[str] = None
    ) -> Optional[threading.Thread]:
        """Record from an Anthropic Messages response (usage.input_tokens/output_tokens)."""
        tin, tout = _usage(response, ("input_tokens", "output_tokens"))
        return self.record(
            provider="anthropic",
            model=model or _attr(response, "model", ""),
            tokens_in=tin,
            tokens_out=tout,
            feature_id=feature_id,
        )

    def record_openai(
        self, response: Any, *, feature_id: Optional[str] = None, model: Optional[str] = None
    ) -> Optional[threading.Thread]:
        """Record from an OpenAI response (usage.prompt_tokens/completion_tokens)."""
        tin, tout = _usage(response, ("prompt_tokens", "completion_tokens"))
        return self.record(
            provider="openai",
            model=model or _attr(response, "model", ""),
            tokens_in=tin,
            tokens_out=tout,
            feature_id=feature_id,
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
