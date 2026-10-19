"""AcuDx results engine: dynamic, physiologically bounded lab, ECG and imaging results.

Submodules
----------
reference_ranges   LOINC/UCUM reference-range table loader (``reference_ranges.json``)
kinetics           parametric time and treatment kinetics (troponin, lactate, CRP, ...)
ecg                12-lead ECG waveform synthesis (ECGSYN-style) and SVG rendering
imaging_bank       license-clean image bank index + resolver (``imaging_bank.json``)
engine             ``resolve_order`` combining case truth, kinetics, ranges and the bank

Design: docs/architecture/14-results-and-imaging-engine.md. Education only.
"""
