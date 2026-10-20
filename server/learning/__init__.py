"""Learner event ingestion and the dean / faculty aggregates built on it.

``POST /v1/events/encounter`` stores one finished encounter (its EncounterEvent log
plus the grade / calibration summary the web progressStore computed) per user and
org, hash-chained per org (SHA-256 over the canonical body and the previous chain
hash). Dean and faculty panels aggregate these rows; nothing in them is derived
from client-side state alone. See docs/architecture/19-identity-roles-and-panels.md.
"""
