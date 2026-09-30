"""The seven Jev comp questions (PRD section 5), in one module.

Jev is early access and its answers depend on exact question wording, so every question
lives here and nothing else in the package spells one out. Questions are plain data,
independent of `typesafe-sdk`; `jev.py` converts them to SDK question objects. The IDs
are for code only: the SDK keys answers by them, but they carry no meaning to the model,
so each question's instructions and criteria are complete on their own.

Exact arithmetic (distance, acreage ratio, months since the event, price per acre versus
the pool) is supplied in `comparison`; the questions never ask Jev to compute anything.
"""

import json
from dataclasses import dataclass
from typing import Any, Literal

QuestionKind = Literal["noul", "score", "choice"]


@dataclass(frozen=True)
class QuestionSpec:
    """One typed question: `criteria` is a true/false pair, ordered score levels, or choices."""

    id: str
    kind: QuestionKind
    instructions: str
    criteria: dict[str, str] | tuple[str, ...]

    def to_wire(self) -> dict[str, Any]:
        """The JSON-serializable form, used for the cache key and as the source of truth."""
        criteria: Any = list(self.criteria) if isinstance(self.criteria, tuple) else self.criteria
        return {
            "id": self.id,
            "type": self.kind,
            "instructions": self.instructions,
            "criteria": criteria,
        }


QUESTIONS: tuple[QuestionSpec, ...] = (
    QuestionSpec(
        id="is_good_comp",
        kind="noul",
        instructions=(
            "Would an experienced vacant-land investor use `candidate` as a comparable "
            "sale or listing to value `subject`? Consider size, land use, access, and "
            "market together, using the facts in `comparison`."
        ),
        criteria={
            "true": (
                "The candidate is similar land in a similar market and use: comparable "
                "acreage, the same kind of land, and a location whose prices would carry "
                "over to the subject."
            ),
            "false": (
                "The candidate is materially different from the subject in size, use, "
                "access, or market, so its price would mislead a valuation of the subject."
            ),
        },
    ),
    QuestionSpec(
        id="arms_length",
        kind="noul",
        instructions=(
            "Does `candidate` look like an arm's-length, open-market transaction or "
            "listing, priced by a willing buyer and willing seller with no special "
            "relationship or compulsion?"
        ),
        criteria={
            "true": "An ordinary open-market sale or listing at a price the market would set.",
            "false": (
                "Not arm's-length: a nominal price, a family, quitclaim, gift, tax, or "
                "foreclosure transfer, or a bundled multi-parcel sale whose price does not "
                "reflect this parcel alone."
            ),
        },
    ),
    QuestionSpec(
        id="physical_similarity",
        kind="score",
        instructions=(
            "How similar is the candidate's land to the subject's land in terrain, "
            "buildability, vegetation, water, and improvements?"
        ),
        criteria=(
            "Different land type, for example an improved lot or a house versus raw "
            "acreage, or a steep unbuildable parcel versus level buildable land.",
            "Same broad land type but clearly different physical character, for example "
            "heavily wooded mountain terrain versus open flat meadow, or a very different "
            "buildable area.",
            "Similar land with minor physical differences in terrain, cover, or water that "
            "would move the price only modestly.",
            "Essentially the same land type and buildability: comparable terrain, cover, "
            "water, and no improvements that set it apart.",
        ),
    ),
    QuestionSpec(
        id="access_utilities_similarity",
        kind="score",
        instructions=(
            "How similar are the candidate's legal and physical access and its utility "
            "availability to the subject's?"
        ),
        criteria=(
            "Opposite situations, for example one parcel is landlocked or off-grid while "
            "the other is road-front with utilities available.",
            "Clearly different access or utilities, for example a maintained county road "
            "versus an easement or a rough private road, or electric at the street versus "
            "no utilities nearby.",
            "Mostly the same access type and utilities, with a minor difference such as "
            "road surface or the distance to a utility connection.",
            "Same access type and the same utilities available.",
        ),
    ),
    QuestionSpec(
        id="market_similarity",
        kind="score",
        instructions=(
            "How similar is the candidate's local market to the subject's, in "
            "neighborhood character, zoning and permitted use, and rural versus suburban "
            "setting? Take `comparison.distance_miles` and zoning into account."
        ),
        criteria=(
            "A different market: another kind of area (for example resort or town-edge "
            "versus remote rural) or an incompatible zoning or use.",
            "A loosely related market, distant or with a different neighborhood character "
            "or zoning, so buyers and prices differ noticeably.",
            "A similar market nearby, with a minor difference in neighborhood or zoning.",
            "The same local market: the same neighborhood character and zoning or use, "
            "close enough that the same buyers would compete for both.",
        ),
    ),
    QuestionSpec(
        id="red_flags",
        kind="noul",
        instructions=(
            "Does the candidate's data or description reveal an issue that distorts its "
            "price, such as landlocked or no legal access, flood zone, HOA restrictions, "
            "severed mineral rights, owner-financed terms that inflate the price, an "
            "auction, or a partial interest?"
        ),
        criteria={
            "true": (
                "The data or description names at least one such issue, so the price does "
                "not reflect a clean, comparable parcel."
            ),
            "false": "Nothing in the data or description points to a price-distorting issue.",
        },
    ),
    QuestionSpec(
        id="quality_tier",
        kind="choice",
        instructions=(
            "Overall, how good is `candidate` as a comparable for valuing `subject`? "
            "Weigh land similarity, access, market, recency, and any red flags."
        ),
        criteria={
            "excellent": (
                "Nearly interchangeable with the subject; you would rely on it as a "
                "primary comp with little or no adjustment."
            ),
            "good": (
                "Similar in the ways that matter; useful as a comp with small adjustments "
                "for size, access, or timing."
            ),
            "marginal": (
                "Some relevance but with real differences or concerns; useful only as "
                "supporting evidence alongside better comps."
            ),
            "reject": (
                "Not a usable comp: materially different, not arm's-length, or distorted "
                "by a serious issue."
            ),
        },
    ),
)

QUESTION_IDS: tuple[str, ...] = tuple(spec.id for spec in QUESTIONS)


def questions_json() -> str:
    """Canonical JSON of the whole question set; hashed into the Jev cache key."""
    return json.dumps([spec.to_wire() for spec in QUESTIONS], sort_keys=True)
