"""Cost-optimization estimator (heuristic, transparent).

IMPORTANT: unlike the rest of Annapurna, these are *estimates*, not measured
numbers. They are directional projections derived from a feature's inference
usage (spend, model mix, input/output token split, request volume) using simple,
explainable rules. Every opportunity carries a confidence and a rationale so the
projection is never a black box — but it is a projection, and it's labelled as
such in the UI.

The percentages below are deliberately conservative rules of thumb.
"""

from __future__ import annotations

# Models considered "premium" — candidates for a downgrade to a cheaper tier.
PREMIUM_MODELS = {"claude-opus-4-8", "claude-sonnet-4-6", "gpt-4o"}


def estimate(
    total: float,
    input_cost: float,
    output_cost: float,
    premium_cost: float,
    requests: int | None,
) -> dict:
    """Return {opportunities, monthly_savings, annual_savings} for one feature/month.

    `input_cost` / `output_cost` are the cost split by token type; `premium_cost`
    is spend on premium models; `requests` is the monthly call count.
    """
    opportunities: list[dict] = []

    def add(name: str, savings: float, confidence: str, rationale: str) -> None:
        value = round(savings, 2)
        if value >= 1:  # ignore sub-dollar noise
            opportunities.append(
                {
                    "opportunity": name,
                    "savings": value,
                    "confidence": confidence,
                    "rationale": rationale,
                }
            )

    if total <= 0:
        return {"opportunities": [], "monthly_savings": 0.0, "annual_savings": 0.0}

    input_share = input_cost / total if total else 0.0

    if premium_cost > 0:
        add(
            "Model downgrade",
            premium_cost * 0.10,
            "med",
            "Route a share of premium-model calls to a cheaper model where quality allows.",
        )
    if input_share >= 0.5:
        add(
            "Prompt caching",
            input_cost * 0.12,
            "high" if input_share >= 0.7 else "med",
            "Cache repeated prompt prefixes (system prompts, shared context) at a large discount.",
        )
    add(
        "Context reduction",
        input_cost * 0.05,
        "low",
        "Trim retrieved/added context per call to lower input tokens.",
    )
    add(
        "Output token reduction",
        output_cost * 0.08,
        "low",
        "Tighten prompts and response format to produce shorter outputs.",
    )
    if requests and requests >= 50_000:
        add(
            "Semantic caching",
            total * 0.03,
            "low",
            "Reuse responses for semantically similar requests to avoid duplicate calls.",
        )

    monthly = round(sum(o["savings"] for o in opportunities), 2)
    return {
        "opportunities": opportunities,
        "monthly_savings": monthly,
        "annual_savings": round(monthly * 12, 2),
    }
