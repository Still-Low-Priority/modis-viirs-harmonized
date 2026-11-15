from typing import Literal, TypeAlias

ConfidenceLabel: TypeAlias = Literal[
    "low",
    "nominal",
    "high",
] | None
