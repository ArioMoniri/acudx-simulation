"""AcuDx guideline store, verifier, attending tips and routes.

The package realises the "verified, versioned GuidelineStatement" contract described in
docs/architecture/16-guideline-store-and-verification.md:

* ``store``    SQLite-backed GuidelineStatement table (ACUDX_DB_PATH).
* ``seed_open`` open-licence statements with exact document URLs, plus URL refinements and
               condition-code mappings for the legacy ``server/guidelines_seed.py`` corpus.
* ``verifier`` fetches each source document, extracts text and locates the passage that
               supports the statement; marks it verified or failed with a reason.
* ``tips``     AMBOSS-style attending tips authored ONLY over verified statements.
* ``routes``   the FastAPI surface (/v1/guidelines/*, /admin/guidelines/verify).

Nothing a learner sees may come from a statement whose status is not ``verified``.
"""
