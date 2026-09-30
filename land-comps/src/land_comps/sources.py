"""Errors shared by every candidate source (county sales, LandWatch, Realtor.com)."""


class SourceError(Exception):
    """A candidate source failed. `gather` records these instead of aborting the run.

    `source` names what broke (an Apify actor ID, or a source name such as
    `county_sales`) and `reason` says why, so the failure is visible in the
    run's `source_errors` rather than silently shrinking the candidate pool.
    """

    def __init__(self, source: str, reason: str) -> None:
        super().__init__(f"{source}: {reason}")
        self.source = source
        self.reason = reason
