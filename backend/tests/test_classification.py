"""Environment classifier: the -prod rule and its safe defaults."""

from __future__ import annotations

import pytest
from annapurna import classification


@pytest.mark.parametrize(
    "name, expected",
    [
        ("service-a-prod", "production"),
        ("FOO-PROD", "production"),  # case-insensitive
        ("foo-prod ", "production"),  # trailing whitespace tolerated
        ("  intel-prod", "production"),  # leading whitespace tolerated
        ("foo-dev", "unclassified"),  # -dev is NOT auto-classified
        ("experimental-key", "unclassified"),
        ("prod", "unclassified"),  # must be the *-prod suffix, not the whole name
        ("prod-service", "unclassified"),  # suffix only
        ("", "unclassified"),
        (None, "unclassified"),  # missing name degrades safely
    ],
)
def test_classify_anthropic_prod_suffix(name, expected):
    assert classification.classify_anthropic(name) == expected
    assert classification.classify("anthropic", api_key_name=name) == expected


def test_workspace_name_never_drives_classification():
    # Even a workspace literally named "*-prod" must not make traffic production;
    # only the API-key name does.
    assert (
        classification.classify("anthropic", workspace_name="mcs-prod", api_key_name="experimental")
        == "unclassified"
    )


def test_non_anthropic_providers_default_unclassified():
    assert classification.classify("openai", api_key_name="thing-prod") == "unclassified"


def test_environments_vocabulary_is_complete():
    assert set(classification.ENVIRONMENTS) == {
        "production",
        "development",
        "internal",
        "unclassified",
    }
