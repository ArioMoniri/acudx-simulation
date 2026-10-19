"""AcuDx orchestration: LangGraph case generator v2 and the Clinical Director.

See ``docs/architecture/15-case-generator-v2-and-director.md`` for the graph
diagram and node contracts. Import the pieces you need directly:

    from server.orchestration.graph import build_casegen_graph, CaseGenDeps
    from server.orchestration.director import CaseState, Action, next_state
    from server.orchestration.routes import router
"""
