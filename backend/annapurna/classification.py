"""Environment classification for inference spend (production vs. the rest).

Deterministic, side-effect-free rules that label a unit of provider spend with an
``environment``. Kept isolated from ingestion so tenant-configurable rules can be
layered on later without touching the pipeline.

Milestone scope: ONE automatic rule — an Anthropic API key whose *name* ends in
``-prod`` is production. Everything else is ``unclassified`` (a safe default), so
we never over-claim production or silently assume ``development``. The label must
come from the returned usage dimensions (the API-key name), NEVER from which admin
credential did the reading, the workspace name, the model, or the spend amount.
"""

from __future__ import annotations

from typing import Optional

#: Every environment the schema/UI understands. Only ``production`` and
#: ``unclassified`` are produced automatically today; the other two are reserved
#: for manual (later tenant-configurable) classification.
ENVIRONMENTS = ("production", "development", "internal", "unclassified")

PRODUCTION = "production"
UNCLASSIFIED = "unclassified"

_PROD_SUFFIX = "-prod"


def is_production_key_name(api_key_name: Optional[str]) -> bool:
    """True iff an API-key NAME marks production traffic (``…-prod``, case-insensitive)."""
    if not api_key_name:
        return False
    return api_key_name.strip().lower().endswith(_PROD_SUFFIX)


def classify_anthropic(api_key_name: Optional[str]) -> str:
    """Anthropic rule: ``…-prod`` key name -> production, else unclassified."""
    return PRODUCTION if is_production_key_name(api_key_name) else UNCLASSIFIED


def classify(
    provider: str,
    *,
    workspace_name: Optional[str] = None,  # noqa: ARG001 — reserved; must NOT drive the label
    api_key_name: Optional[str] = None,
) -> str:
    """Environment for a unit of spend. Only the API-key name is consulted.

    ``workspace_name`` is accepted for a stable signature but deliberately unused —
    environment must derive from key identity, not workspace naming.
    """
    if provider == "anthropic":
        return classify_anthropic(api_key_name)
    return UNCLASSIFIED
