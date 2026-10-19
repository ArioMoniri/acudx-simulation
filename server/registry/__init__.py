"""Server-side provider registry: every external dependency (LLM, embed, rerank,
STT, TTS, avatar, imaging, identity, telemetry) is configured at runtime from the
admin panel and persisted in SQLite with secrets encrypted at rest.

See docs/architecture/17-provider-registry-admin-telemetry.md.
"""
