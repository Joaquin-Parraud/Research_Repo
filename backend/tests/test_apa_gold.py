"""APA 7 quality gate: the real citation service against hand-written expected references.

The cases live in ``tests/data/apa_gold.json`` and run against citeproc-js with the official
style (see ``conftest.citeproc_url``), never a mock. There are no expected failures: every case
must pass. A case with ``style_wording`` expects the official style's wording where it differs
from the hand-written APA text, by owner decision; its value says what differs.
"""

import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest

from research_repo.citations.csl import validate_csl
from research_repo.citations.keys import key_base
from research_repo.citations.processor import CiteprocClient, Mode, processor_item

pytestmark = pytest.mark.citeproc

GOLD = json.loads((Path(__file__).parent / "data" / "apa_gold.json").read_text())["cases"]
CASE_KEYS = {
    "name",
    "locale",
    "csl",
    "group",
    "reference_html",
    "bibliography_html",
    "in_text_parenthetical",
    "in_text_narrative",
    "style_wording",
}


@pytest.fixture
async def processor(citeproc_url: str) -> AsyncIterator[CiteprocClient]:
    client = CiteprocClient(citeproc_url, timeout=30)
    yield client
    await client.aclose()


def test_gold_set_shape() -> None:
    assert len(GOLD) >= 23
    assert sum(case["locale"] == "es" for case in GOLD) >= 3
    assert len({case["name"] for case in GOLD}) == len(GOLD)
    for case in GOLD:
        assert set(case) <= CASE_KEYS, case["name"]  # e.g. no "known_failure" any more
    assert [c["name"] for c in GOLD if "style_wording" in c] == ["es-webpage-no-date"]


@pytest.mark.parametrize("case", GOLD, ids=[case["name"] for case in GOLD])
async def test_gold(case: dict[str, Any], processor: CiteprocClient) -> None:
    if "group" in case:
        # One reference list; the group is the disambiguation scope.
        items = {m["key"]: validate_csl(m["csl"]) for m in case["group"]}
        expected: dict[tuple[str, Mode], str] = {
            **{(k, "parenthetical"): v for k, v in case["in_text_parenthetical"].items()},
            **{(k, "narrative"): v for k, v in case["in_text_narrative"].items()},
        }
        payload = await processor.render(
            case["locale"],
            [processor_item(csl, key) for key, csl in items.items()],
            bibliography="all",
            citations=list(expected),
        )
        assert [e["html"] for e in payload["bibliography"]] == case["bibliography_html"]
        assert {(c["id"], c["mode"]): c["text"] for c in payload["citations"]} == expected
        assert payload["excluded_ids"] == []
        return

    csl = validate_csl(case["csl"])
    key = key_base(csl)
    entry = await processor.citation(case["locale"], {key: csl}, key)
    assert entry.reference_html == case["reference_html"]
    assert entry.in_text_parenthetical == case["in_text_parenthetical"]
    assert entry.in_text_narrative == case["in_text_narrative"]
