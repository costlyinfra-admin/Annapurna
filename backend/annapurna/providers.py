"""Read-only provider cost connectors (Anthropic + OpenAI).

Each client fetches a month of spend from a provider's Admin/Cost API and returns
a list of normalized ``CostRecord``s — the authoritative dollar total broken down
by api key / project (workspace) / model. GET-only (read-only). The admin key is
the customer's own, supplied per tenant (stored encrypted).

NOTE: the exact JSON shapes of these Admin APIs evolve and can't be verified
offline. Parsing here follows the documented spec and is deliberately tolerant;
the real responses should be validated against a live account. The normalized
``CostRecord`` is the stable contract the rest of the system depends on, and the
attribution/persistence logic (inference.py) is fully tested against it.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

import httpx

from .pricing import price
from .retrying import http_get_with_retry


@dataclass
class CostRecord:
    provider: str  # "anthropic" | "openai"
    period: dt.date  # month start
    amount: Decimal
    currency: str = "USD"
    api_key_ref: Optional[str] = None
    project: Optional[str] = None  # OpenAI project / Anthropic workspace
    model: Optional[str] = None
    tokens_in: Optional[int] = None
    tokens_out: Optional[int] = None
    request_count: Optional[int] = None


class ProviderError(Exception):
    def __init__(self, message: str, status: Optional[int] = None):
        super().__init__(message)
        self.status = status


def month_start(day: dt.date) -> dt.date:
    return day.replace(day=1)


def next_month(start: dt.date) -> dt.date:
    return (start.replace(day=28) + dt.timedelta(days=4)).replace(day=1)


def aggregate(records: list[CostRecord]) -> list[CostRecord]:
    """Collapse records sharing (api_key_ref, project, model) into one row."""
    buckets: dict[tuple, CostRecord] = {}
    for r in records:
        key = (r.provider, r.period, r.api_key_ref, r.project, r.model, r.currency)
        if key not in buckets:
            buckets[key] = CostRecord(
                provider=r.provider,
                period=r.period,
                amount=Decimal("0"),
                currency=r.currency,
                api_key_ref=r.api_key_ref,
                project=r.project,
                model=r.model,
                tokens_in=0,
                tokens_out=0,
                request_count=0,
            )
        agg = buckets[key]
        agg.amount += r.amount
        agg.tokens_in = (agg.tokens_in or 0) + (r.tokens_in or 0)
        agg.tokens_out = (agg.tokens_out or 0) + (r.tokens_out or 0)
        agg.request_count = (agg.request_count or 0) + (r.request_count or 0)
    return list(buckets.values())


class _BaseCostClient:
    base_url = ""

    def __init__(
        self,
        admin_key: str,
        *,
        client: Optional[httpx.Client] = None,
        base_url: Optional[str] = None,
    ):
        self._key = admin_key
        self._base = (base_url or self.base_url).rstrip("/")
        self._client = client or httpx.Client(timeout=30.0)
        self._owns_client = client is None

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        self.close()

    def close(self):
        if self._owns_client:
            self._client.close()

    def _get(self, path: str, params: dict, headers: dict) -> httpx.Response:
        resp = http_get_with_retry(
            self._client, f"{self._base}{path}", params=params, headers=headers
        )
        if resp.status_code == 401:
            raise ProviderError("Provider rejected the admin key (401).", 401)
        if resp.status_code >= 400:
            raise ProviderError(
                f"Provider API error {resp.status_code}: {resp.text[:200]}", resp.status_code
            )
        return resp


class AnthropicCostClient(_BaseCostClient):
    """Anthropic Admin Usage & Cost API. Auth via x-api-key admin key."""

    base_url = "https://api.anthropic.com"

    def fetch_costs(self, period: dt.date) -> list[CostRecord]:
        start = month_start(period)
        end = next_month(start)
        resp = self._get(
            "/v1/organizations/cost_report",
            params={
                "starting_at": start.isoformat(),
                "ending_at": end.isoformat(),
                "group_by[]": ["workspace_id", "model"],
            },
            headers={
                "x-api-key": self._key,
                "anthropic-version": "2023-06-01",
            },
        )
        return aggregate(list(_parse_anthropic(resp.json(), start)))


class OpenAICostClient(_BaseCostClient):
    """OpenAI organization Costs API. Auth via Bearer admin key."""

    base_url = "https://api.openai.com"

    def fetch_costs(self, period: dt.date) -> list[CostRecord]:
        start = month_start(period)
        end = next_month(start)
        resp = self._get(
            "/v1/organization/costs",
            params={
                "start_time": int(dt.datetime(start.year, start.month, start.day).timestamp()),
                "end_time": int(dt.datetime(end.year, end.month, end.day).timestamp()),
                "group_by[]": ["project_id", "line_item"],
                "limit": 180,
            },
            headers={"Authorization": f"Bearer {self._key}"},
        )
        return aggregate(list(_parse_openai(resp.json(), start)))


def _parse_anthropic(payload: dict, period: dt.date):
    for bucket in payload.get("data", []):
        for item in bucket.get("results", []) or bucket.get("items", []):
            amount = _to_decimal(item.get("amount") or item.get("cost") or item.get("amount_usd"))
            if amount is None:
                continue
            yield CostRecord(
                provider="anthropic",
                period=period,
                amount=amount,
                currency=item.get("currency", "USD"),
                api_key_ref=item.get("api_key_id"),
                project=item.get("workspace_id"),
                model=item.get("model"),
            )


def _parse_openai(payload: dict, period: dt.date):
    for bucket in payload.get("data", []):
        for item in bucket.get("results", []):
            amount = _to_decimal(
                (item.get("amount") or {}).get("value")
                if isinstance(item.get("amount"), dict)
                else item.get("amount")
            )
            if amount is None:
                continue
            yield CostRecord(
                provider="openai",
                period=period,
                amount=amount,
                currency=(item.get("amount") or {}).get("currency", "USD")
                if isinstance(item.get("amount"), dict)
                else "USD",
                api_key_ref=item.get("api_key_id"),
                project=item.get("project_id"),
                model=item.get("model") or item.get("line_item"),
            )


def _to_decimal(value) -> Optional[Decimal]:
    if value is None or isinstance(value, (dict, list)):
        return None
    try:
        return Decimal(str(value))
    except (ValueError, ArithmeticError):
        return None


# --------------------------------------------------------------------------
# Hosted open-source aggregators (Together, Fireworks, OpenRouter)
# --------------------------------------------------------------------------
# Each fronts many open-weight models behind one API key. Their usage/cost APIs
# are OpenAI-ish and return per-(model, key) rows for a window. Cost is taken
# from a reported dollar amount when present, else computed from token counts via
# our pricing tables (keyed by (provider, model)). As with the Anthropic/OpenAI
# clients, the exact JSON shapes can't be verified offline — parsing is tolerant
# and the stable contract is the normalized CostRecord.
_HOSTED_PROVIDERS = {
    "openrouter": ("https://openrouter.ai", "/api/v1/activity"),
    "together": ("https://api.together.xyz", "/v1/usage"),
    "fireworks": ("https://api.fireworks.ai", "/v1/usage"),
}


class HostedUsageCostClient(_BaseCostClient):
    """Generic cost client for hosted open-source aggregators."""

    def __init__(self, provider: str, admin_key: str, path: str, **kwargs):
        super().__init__(admin_key, **kwargs)
        self.provider = provider
        self.path = path

    def fetch_costs(self, period: dt.date) -> list[CostRecord]:
        start = month_start(period)
        end = next_month(start)
        resp = self._get(
            self.path,
            params={"start_date": start.isoformat(), "end_date": end.isoformat()},
            headers={"Authorization": f"Bearer {self._key}"},
        )
        return aggregate(list(_parse_hosted_usage(resp.json(), self.provider, start)))


def _parse_hosted_usage(payload: dict, provider: str, period: dt.date):
    rows = payload.get("data") or payload.get("usage") or payload.get("results") or []
    for item in rows:
        if not isinstance(item, dict):
            continue
        model = item.get("model") or item.get("model_name")
        tokens_in = int(
            item.get("prompt_tokens") or item.get("input_tokens") or item.get("tokens_in") or 0
        )
        tokens_out = int(
            item.get("completion_tokens")
            or item.get("output_tokens")
            or item.get("tokens_out")
            or 0
        )
        requests = item.get("requests") or item.get("request_count") or item.get("count")
        # Prefer a reported dollar cost; otherwise price the tokens ourselves.
        amount = _to_decimal(
            item.get("cost") or item.get("amount") or item.get("total_cost") or item.get("usage")
        )
        if amount is None:
            amount = price(model or "", tokens_in, tokens_out, provider)
        yield CostRecord(
            provider=provider,
            period=period,
            amount=amount,
            currency=item.get("currency", "USD"),
            api_key_ref=item.get("api_key_id") or item.get("api_key"),
            model=model,
            tokens_in=tokens_in or None,
            tokens_out=tokens_out or None,
            request_count=int(requests) if requests is not None else None,
        )


def make_cost_client(provider: str, admin_key: str) -> _BaseCostClient:
    if provider == "anthropic":
        return AnthropicCostClient(admin_key)
    if provider == "openai":
        return OpenAICostClient(admin_key)
    if provider in _HOSTED_PROVIDERS:
        base_url, path = _HOSTED_PROVIDERS[provider]
        return HostedUsageCostClient(provider, admin_key, path, base_url=base_url)
    raise ValueError(f"Unknown inference provider: {provider}")
