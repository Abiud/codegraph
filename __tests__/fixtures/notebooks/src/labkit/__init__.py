"""Lab analysis helpers, re-exported for `import labkit as lk`."""

from labkit.plots import (
    heatmap,  # clustered expression heatmap
    volcano,
)
from .stats import fit_model

__all__ = ["fit_model", "heatmap", "volcano"]
