# 16 - Agent Orchestration, Model Access, Identity, One-Click Deploy, Telemetry (October 2026)

**Scope.** Stack decisions for (a) the realtime Dynamic Case Generator + Clinical Director agents behind `server/` (FastAPI model gateway), (b) OpenAI-compatible model access and self-hosting, (c) identity and university SSO/LTI, (d) one-click deploy with "paste a domain, get TLS", including a Lambda GPU worker, and (e) telemetry and per-call cost tracking for the admin panel.

**Grounding.** Researched 2026-10-19 with web search plus direct fetches of official docs, PyPI, GitHub releases and pricing pages. Every claim carries its URL. Items I could not confirm on a primary source are tagged **[unverified]**. Prices are USD per 1M tokens unless stated. Treat prices as a snapshot; pin the architecture, not the numbers.

**Related docs.** `01-llm-models-and-cost.md` (frontier model routing), `08-open-source-model-stack.md` and `11-fully-open-source-stack.md` (open-weight stack), `06-regulatory-compliance.md` (data handling constraints that bear on telemetry and identity).

---

## 0. Fifteen-line summary

1. **Orchestration: LangGraph 1.x (Python) is the recommended core** for the Case Generator + Clinical Director: StateGraph with reducers, `Send` for fan-out, `interrupt()`/`Command(resume=)` for faculty approval gates, PostgresSaver checkpoints, subgraphs per agent. Current release langgraph 1.2.16 (2026-10-16). ([PyPI](https://pypi.org/project/langgraph/), [Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api), [v1 notes](https://docs.langchain.com/oss/python/langgraph-v1))
2. **Pydantic AI 2.57 is the runner-up** (typed agents, Pydantic Graph, durable execution on Temporal/DBOS/Prefect, Pydantic Evals); use it for strictly typed single agents inside LangGraph nodes if desired. OpenAI Agents SDK 0.24 and Claude Agent SDK 0.2.168 are vendor-leaning; CrewAI 1.15 is fast to prototype but abstracts control; AG2 1.x is a rewrite and AutoGen (0.7.5, Sep 2025) is in maintenance mode behind Microsoft Agent Framework 1.0. ([PyPI pydantic-ai](https://pypi.org/project/pydantic-ai/), [openai-agents](https://pypi.org/project/openai-agents/), [claude-agent-sdk](https://pypi.org/project/claude-agent-sdk/), [crewai](https://pypi.org/project/crewai/), [ag2](https://pypi.org/project/ag2/), [autogen-agentchat](https://pypi.org/project/autogen-agentchat/))
3. **Verification: a diverse "jury" (PoLL) of 3 judges from different model families** beats one large judge, but correlated errors cut effective votes; route high-stakes "accept" decisions (diagnosis grading, drug dosing) to grounded guideline checks, not more votes. ([PoLL](https://arxiv.org/abs/2404.18796), [Nine Judges, Two Effective Votes](https://arxiv.org/pdf/2605.29800), [ROPOLL](https://www.amazon.science/publications/ropoll-robust-panel-of-llm-judges), [JuryProbe](https://arxiv.org/pdf/2608.20607))
4. **Evals/observability: Langfuse (self-hosted, MIT core, ClickHouse) for tracing and per-model cost, promptfoo in CI, DeepEval (Apache-2.0) for agent metrics in pytest; Braintrust only if you want a $249/mo managed experiment UI.** ([Langfuse self-host](https://langfuse.com/self-hosting), [Langfuse cost](https://langfuse.com/docs/model-usage-and-cost), [DeepEval](https://github.com/confident-ai/deepeval), [promptfoo](https://www.promptfoo.dev/docs/intro/), [Braintrust pricing](https://www.braintrust.dev/pricing))
5. **Student longitudinal memory: LangGraph Store + LangMem (MIT) as the default, Mem0 OSS (Apache-2.0, pgvector) if you want a separate memory service; Graphiti (Apache-2.0) if you need bi-temporal "what did the student know when" facts.** Letta is an agent runtime, not a drop-in memory layer. ([LangMem](https://github.com/langchain-ai/langmem), [Mem0](https://github.com/mem0ai/mem0), [Graphiti](https://github.com/getzep/graphiti), [Letta](https://github.com/letta-ai/letta))
6. **Guardrails: layer, do not pick one.** NeMo Guardrails 0.24.x for dialogue/topical rails, Guardrails AI 0.11 for output schema validators, Llama Guard 4 12B as a content classifier (Llama 4 Community License; EU domicile restriction on multimodal Llama 4). ([NeMo releases](https://github.com/NVIDIA-NeMo/Guardrails/releases), [Guardrails AI releases](https://github.com/guardrails-ai/guardrails/releases), [Llama Guard 4 HF](https://huggingface.co/meta-llama/Llama-Guard-4-12B))
7. **Lambda Inference API (api.lambda.ai) is winding down.** Lambda's own page: "As the Inference API winds down, you can continue deploying and scaling models seamlessly on NVIDIA GPU instances." No end date published. Do not build on it; use Lambda for GPUs. ([lambda.ai/inference](https://lambda.ai/inference))
8. **Cheapest OpenAI-compatible open-weight access in Oct 2026 is DeepInfra** (Qwen3-32B $0.08/$0.28, Qwen3-235B-A22B-Instruct $0.09/$0.55, DeepSeek-V3.2 $0.26/$0.38, DeepSeek-V4-Flash $0.09/$0.18, Gemma 3 27B $0.08/$0.16, Llama Guard 4 $0.18/$0.18). Groq gpt-oss-120b $0.15/$0.60 at ~500 tok/s. Together gpt-oss-120b $0.15/$0.60. HF Inference Providers router passes provider prices through with no markup; OpenRouter adds ~5.5% on credit purchase. ([DeepInfra](https://deepinfra.com/pricing), [Groq models](https://console.groq.com/docs/models), [Together](https://www.together.ai/pricing), [HF pricing](https://huggingface.co/docs/inference-providers/en/pricing))
9. **Medical-tuned open weights: MedGemma 27B (text and multimodal) and MedGemma 1.5 4B** under Health AI Developer Foundations terms (not Apache; code is Apache). No 27B 1.5 checkpoint is published in Google's HF collection. Not for clinical use; fine for simulated-patient and case-authoring roles with verification. ([Model card](https://developers.google.com/health-ai-developer-foundations/medgemma/model-card), [HF collection](https://huggingface.co/collections/google/medgemma-release-680aade845f90bec6a3f60c4))
10. **Self-host: vLLM 0.32.0 (2026-10-18, drops Python 3.10) or SGLang 0.5.22 (2026-10-19, needs Python 3.11).** On one H100 80GB: gpt-oss-120b in MXFP4 fits natively; Qwen3-32B FP8. On one A100 80GB: no FP8 W8A8; use AWQ/GPTQ INT4 or INT8 W8A8. Engines are within a few percent of each other; benchmark your own prompts with `vllm bench serve`. ([vLLM releases](https://github.com/vllm-project/vllm/releases), [SGLang releases](https://github.com/sgl-project/sglang/releases), [vLLM quantization](https://docs.vllm.ai/en/stable/features/quantization/), [gpt-oss-120b](https://huggingface.co/openai/gpt-oss-120b))
11. **Identity: Keycloak 26.8.1 (2026-10-13) is the open-source default** (strongest SAML, Organizations, SAML step-up supported since 26.7). **Managed option: Supabase Auth** (Pro $25/mo, 100k MAU, SAML on Pro at $0.015/SSO-MAU after 50) for a cheap managed path, or Clerk ($25/mo, 50k MRU, 1 SAML connection on Pro) for B2B polish. authentik (MIT) is the lighter self-host alternative. **Pipedream Connect is not an IdP**: it is managed OAuth for third-party app connections and recommends Clerk/Auth0/Firebase for your own login. ([Keycloak 26.8.1](https://www.keycloak.org/2026/10/keycloak-2681-released), [Supabase pricing](https://supabase.com/pricing), [Clerk pricing](https://clerk.com/pricing), [Pipedream Connect](https://pipedream.com/docs/connect))
12. **University SSO: Keycloak cannot consume eduGAIN federation metadata natively; put Shibboleth SP or a SATOSA/pyFF proxy in front, or onboard each university as one SAML IdP in Keycloak.** LTI 1.3: ltijs (Node, Apache-2.0, v7 TypeScript rewrite) is active; pylti1.3 (MIT) is in occasional-bugfix mode, so for Python use django-lti/pylti1p3 with a fork plan. ([Keycloak forum](https://forum.keycloak.org/t/using-keycloak-with-shibboleth-wayf-samlds/8609), [ltijs](https://github.com/Cvmcosta/ltijs), [pylti1.3](https://github.com/dmitry-viskov/pylti1.3), [django-lti issue](https://github.com/academic-innovation/django-lti/issues/108))
13. **Deploy: Coolify (Traefik or Caddy, "use https:// for automatic TLS") or Dokploy (Traefik + Let's Encrypt toggle) give "paste domain, done" on your own VM; Railway, Render, Fly.io and Vercel all auto-issue certs for custom domains; AWS App Runner is closed to new customers (AWS points to ECS Express Mode).** Plain Docker Compose + Caddy is the zero-vendor version; Cloudflare Tunnel adds TLS at the edge with no open inbound ports. ([Coolify domains](https://coolify.io/docs/knowledge-base/domains), [Dokploy domains](https://docs.dokploy.com/docs/core/domains), [App Runner notice](https://docs.aws.amazon.com/apprunner/latest/dg/manage-custom-domains.html), [Caddy](https://caddyserver.com/docs/automatic-https))
14. **Lambda Cloud API (`https://cloud.lambda.ai/api/v1`, Bearer key): `POST /instance-operations/launch` with `region_name`, `instance_type_name`, `ssh_key_names`, optional `file_system_names`, `firewall_rulesets` (must be attached at launch), `user_data` cloud-init up to 1 MB.** Default firewall opens only port 22; firewall rules do not apply in us-south-1. On-demand 1x H100 PCIe $3.29/hr, 1x A100 40GB $1.99/hr, 1x GH200 $2.29/hr (DeepInfra rents H100 at $2.20/hr, A100 80GB at $0.89/hr if you only need a serving box). ([Cloud API](https://docs.lambda.ai/api/cloud), [Firewalls](https://docs.lambda.ai/public-cloud/firewalls/), [Lambda pricing](https://lambda.ai/pricing), [DeepInfra GPU](https://deepinfra.com/pricing))
15. **Telemetry: emit OpenTelemetry GenAI spans (`gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, still Development stability) once from the gateway, export OTLP/HTTP to Langfuse for per-model/user/session cost and to Grafana (Tempo/Loki/Prometheus) for infra; compute cost in the gateway from a versioned price table, not from histograms.** PostHog AI Observability is a fine product-analytics complement but not a replacement for traces. ([OTel GenAI repo](https://github.com/open-telemetry/semantic-conventions-genai), [Langfuse cost](https://langfuse.com/docs/model-usage-and-cost), [Grafana AI Observability](https://grafana.com/docs/grafana-cloud/monitor-applications/ai-observability/), [PostHog](https://posthog.com/docs/llm-analytics))

---

## 1. Agent orchestration for a realtime Dynamic Case Generator + Clinical Director

### 1.1 What the two agents need

- **Dynamic Case Generator**: fan out (vitals, labs, imaging, social history) from one seed, merge into a consistent case, validate against guideline constraints, pause for faculty approval in authoring mode, stream partial state to the React client.
- **Clinical Director**: a long-running stateful loop per encounter that reads student actions, updates patient physiology, decides when to escalate, grades, and writes longitudinal notes about the student. Needs durable checkpoints (students reconnect), human-in-the-loop (faculty override), and per-student memory that survives across encounters.

### 1.2 LangGraph 1.x current API (Python)

- **Release status**: langgraph 1.2.16 on PyPI, released 2026-10-16, Python 3.10+. ([PyPI](https://pypi.org/project/langgraph/)). The 1.0 release notes call it "a stability-focused release for the agent runtime"; graph primitives and execution model unchanged from 0.x; `create_react_agent` is deprecated in favor of LangChain's `create_agent` with middleware. ([LangGraph v1 release notes](https://docs.langchain.com/oss/python/langgraph-v1))
- **StateGraph**: state is a `TypedDict`/dataclass/Pydantic model; each key may carry a reducer (`Annotated[list[str], operator.add]`); keys without a reducer are overwritten; `Overwrite` bypasses a merging reducer; `MessagesState`/`add_messages` for chat history. Nodes are plain sync/async functions returning partial updates. `add_edge`, `add_conditional_edges(node, router, mapping)`. Compile is required and accepts `checkpointer=` and breakpoints. ([Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api))
- **Send (map-reduce)**: a conditional edge returns `[Send("worker", {...}) for s in subjects]` to run one node per item with its own input; item count need not be known ahead. This is the Case Generator fan-out. ([Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api))
- **Command**: `Command(update=..., goto=...)` combines state update and routing; `graph=Command.PARENT` routes from a subgraph to the parent; `Command(resume=...)` resumes after an interrupt. ([Graph API](https://docs.langchain.com/oss/python/langgraph/graph-api))
- **Interrupts**: `interrupt(payload)` pauses at the call site, persists via the checkpointer, returns the payload to the caller; resume with `Command(resume=value)` on the same `thread_id`. The node re-runs from its start on resume, so code before `interrupt()` must be idempotent. `response_schema` validation requires langgraph >= 1.2.12. Static `interrupt_before/after` are for debugging. Parallel branch interrupts are resumed with a dict keyed by interrupt ID. ([Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts))
- **Checkpointers and Store**: `InMemorySaver` (dev), `SqliteSaver` (local), `PostgresSaver`/`AsyncPostgresSaver` (production; keep `thread_id` under 255 chars). Checkpoints accumulate, so prune on a schedule. A separate `Store` holds cross-thread key-value memory (user preferences, facts), which is the right home for per-student state shared across encounters. ([Persistence](https://docs.langchain.com/oss/python/langgraph/persistence))
- **Subgraphs**: three persistence modes, per-invocation (default, inherits parent checkpointer, interrupts work), per-thread (`checkpointer=True`, own history, time travel inside the subgraph), stateless (`checkpointer=None`, no interrupts). Shared keys between parent and subgraph need a reducer on the parent. ([Subgraphs](https://docs.langchain.com/oss/python/langgraph/use-subgraphs), [Time travel](https://docs.langchain.com/oss/python/langgraph/use-time-travel))

### 1.3 Framework comparison (versions checked 2026-10-19)

| Framework | Version / date | Fit for AcuDx | Notes and source |
|---|---|---|---|
| LangGraph | 1.2.16, 2026-10-16 | **Best** | Durable graph, interrupts, Send, Postgres checkpointer, Store. Provider agnostic (OpenAI-compatible via LangChain). ([PyPI](https://pypi.org/project/langgraph/)) |
| Pydantic AI | 2.57.0, 2026-10-16 | Strong second | Typed agents and tools, Pydantic Graph, durable execution on "nine engines" (Temporal, DBOS, Prefect, Restate, AWS Lambda, Kitaru, Airflow, Absurd, pgtask), Pydantic Evals, MCP. ([PyPI](https://pypi.org/project/pydantic-ai/)) |
| OpenAI Agents SDK | 0.24.0, 2026-10-15 | Vendor-leaning | Handoffs, guardrails, sessions, tracing, realtime voice (gpt-realtime-2.1); "provider-agnostic" via Chat Completions/LiteLLM but tracing and realtime are OpenAI-centric. ([PyPI](https://pypi.org/project/openai-agents/)) |
| Claude Agent SDK | 0.2.168, 2026-10-15 | Vendor-specific harness | Python SDK over the bundled Claude Code CLI; hooks (`PreToolUse`), in-process MCP servers via `@tool`, subagents. Great for coding/computer-use agents, not a neutral orchestrator. ([PyPI](https://pypi.org/project/claude-agent-sdk/)) |
| CrewAI | 1.15.28, 2026-10-14 | Prototyping | Crews (role agents) and Flows (event-driven). Reviewers flag heavy abstractions and low control. ([PyPI](https://pypi.org/project/crewai/), [Langfuse comparison](https://langfuse.com/blog/2025-03-19-ai-agent-comparison)) |
| AG2 | 1.1.2, 2026-10-03 | Niche | v1.0 is a protocol-driven rewrite, not a drop-in from AutoGen; classic code moved to `ag2-classic`. Hub with typed channels, HITL hooks. ([PyPI](https://pypi.org/project/ag2/)) |
| AutoGen (Microsoft) | autogen-agentchat 0.7.5, 2025-09-30 | Avoid for new work | Maintenance mode since 2025-10-02 per secondary sources; successor Microsoft Agent Framework 1.0 GA 2026-04-03 **[dates unverified on microsoft.com]**. ([PyPI](https://pypi.org/project/autogen-agentchat/), [atlan](https://atlan.com/know/ai-agent/microsoft/agent-framework/), [VS Magazine](https://visualstudiomagazine.com/articles/2026/04/06/microsoft-ships-production-ready-agent-framework-1-0-for-net-and-python.aspx)) |

Independent 2026 roundups converge on: LangGraph for complex stateful production work, Pydantic AI for typed Python, vendor SDKs when committed to one model vendor, CrewAI for quick prototypes. ([Speakeasy](https://www.speakeasy.com/blog/ai-agent-framework-comparison), [qubittool](https://qubittool.com/blog/ai-agent-framework-comparison-2026), [ianas.fr](https://ianas.fr/en/blog/2026/06/02/crewai-langchain-langgraph-comparatif-pragmatique/))

### 1.4 "Agent council" / multi-judge verification

- **Panel of LLM evaluators (PoLL)**: three smaller judges from different families (command-r, gpt-3.5-turbo, haiku in the paper) beat a single GPT-4 judge across six datasets, with less intra-model bias and lower cost. ([Verga et al. 2024](https://arxiv.org/abs/2404.18796))
- **ChatEval**: persona-assigned referee agents debate, then aggregate by majority or average rather than forcing consensus. ([Arize summary](https://arize.com/resources/llm-as-a-jury/), [Evidently](https://www.evidentlyai.com/blog/llm-judges-jury))
- **Caveats from 2026 work**: correlated judge errors mean "nine judges" can give "two effective votes" ([arXiv 2605.29800](https://arxiv.org/pdf/2605.29800)); PoLL has unbounded bias under any contamination from a sycophantic judge, so use a robust estimator ([ROPOLL, Amazon Science](https://www.amazon.science/publications/ropoll-robust-panel-of-llm-judges)); JuryProbe routes high-risk "accept" decisions on factual claims to grounded verification instead of more votes ([arXiv 2608.20607](https://arxiv.org/pdf/2608.20607)); calibration regime map for finite panels ([arXiv 2606.01034](https://arxiv.org/pdf/2606.01034)).
- **AcuDx design**: Clinical Director output passes a 3-judge panel (one open-weight model on DeepInfra/self-host, one Claude, one Gemini or GPT) with a robust aggregator; any "safe" verdict on dosing, red-flag omission or diagnosis grading additionally runs a deterministic guideline check (see `05-clinical-guideline-grounding.md`). Implement the panel as a LangGraph `Send` fan-out into a `judge` subgraph with a reducer that stores all votes, then an `aggregate` node.

### 1.5 Harness and eval tooling

| Tool | What it is | Status (Oct 2026) | Source |
|---|---|---|---|
| Langfuse | Tracing, prompt mgmt, evals, cost by model/user/session; self-hosted (web + worker + Postgres + ClickHouse + Redis/Valkey + S3) via Compose or Helm | Now "Langfuse v4" docs; v4 raises minimums to ClickHouse 25.12, Postgres 15, Redis 7 **[minimums unverified on langfuse.com]**; OTLP over HTTP at `/api/public/otel` (no gRPC); core MIT, `ee/` dirs commercial; Langfuse joined ClickHouse, "no planned changes to licensing" | [Self-hosting](https://langfuse.com/self-hosting), [Clarifications](https://langfuse.com/resources/engineering/clarifications), [Joining ClickHouse](https://langfuse.com/blog/joining-clickhouse), [sakutto](https://sakutto.ai/en/articles/langfuse) |
| DeepEval | pytest-style LLM tests; G-Eval; agent metrics (Task Completion, Tool Correctness, Goal Accuracy, Step Efficiency, Plan Adherence, Argument Correctness) | Apache-2.0, ~19k stars; Confident AI is the separate paid monitoring platform | [GitHub](https://github.com/confident-ai/deepeval) |
| promptfoo | CLI/library for declarative evals and red-teaming, CI GitHub Action | Open source, ~26k stars; offline/CI only, not production scoring | [Docs](https://www.promptfoo.dev/docs/intro/), [aiml.qa benchmark](https://aiml.qa/llm-evaluation-framework-benchmark-2026/) |
| Braintrust | Managed experiments, CI gates, RBAC | Starter $0 (14-day retention), Pro $249/mo, Enterprise on-prem; proprietary | [Pricing](https://www.braintrust.dev/pricing) |

### 1.6 Memory layers for per-student longitudinal memory

| Layer | License / model | Fit | Source |
|---|---|---|---|
| LangGraph Store + LangMem | MIT; hot-path memory tools plus background memory manager; native to LangGraph Store | **Default**: zero extra service, same Postgres | [LangMem](https://github.com/langchain-ai/langmem), [Persistence](https://docs.langchain.com/oss/python/langgraph/persistence) |
| Mem0 OSS | Apache-2.0, ~67.5k stars; library (Qdrant + SQLite default) or self-hosted server (Postgres + pgvector, per-user API keys, audit log); user/session/agent scopes; default LLM gpt-5-mini (configurable) | Good if memory should be a separate service shared with the web app; LoCoMo 92.5 is vendor-reported and platform-only | [GitHub](https://github.com/mem0ai/mem0), [OSS docs](https://docs.mem0.ai/open-source/overview) |
| Zep / Graphiti | Graphiti Apache-2.0; bi-temporal facts ("old facts are invalidated, not deleted"); Neo4j 5.26 or FalkorDB 1.1.2 (Kuzu deprecated); Zep cloud is the managed proprietary layer | Use when you need "what did the student believe at week 3" audit trails | [Graphiti](https://github.com/getzep/graphiti) |
| Letta | Apache-2.0 agent runtime (formerly MemGPT), now centered on `letta-code` and an App Server; memory blocks, "MemFS", shared memory | A whole runtime; overlaps LangGraph, so skip | [GitHub](https://github.com/letta-ai/letta), [Docs](https://docs.letta.com/) |

Benchmarks across these vendors are self-reported and disputed (Zep vs Mem0 LongMemEval numbers). ([atlan](https://atlan.com/know/best-ai-agent-memory-frameworks-2026/), [mnemoverse](https://mnemoverse.com/docs/library/ai-memory-solutions-2026-q3))

### 1.7 Guardrail stack

- **NeMo Guardrails** v0.24.1 (2026-09-16): IORails engine runs 59 of 67 rail surfaces, `RailOutcome` allow/block/transform, `/v1/checks` output checking, health endpoints; Colang 1 flows still supported, Colang 2 public runtime state rejected since 0.22. ([Releases](https://github.com/NVIDIA-NeMo/Guardrails/releases))
- **Guardrails AI** v0.11.0 (2026-08-14): deprecates the hub CLI and private registry, validators move to public PyPI; Guard Server runs as standalone HTTP. ([Releases](https://github.com/guardrails-ai/guardrails/releases))
- **Llama Guard 4 12B**: dense model pruned from Llama 4 Scout, text + image, MLCommons 14-hazard taxonomy plus code-interpreter abuse; Llama 4 Community License; Meta does not grant multimodal Llama 4 rights to EU-domiciled entities. Hosted on DeepInfra at $0.18/$0.18 and Groq. ([HF](https://huggingface.co/meta-llama/Llama-Guard-4-12B), [HF blog](https://huggingface.co/blog/llama-guard-4), [Groq note](https://console.groq.com/docs/model/llama-guard-4-12b), [DeepInfra](https://deepinfra.com/pricing))
- **Pattern**: classifier (Llama Guard 4 or a medical-specific self-check) for input/output content, NeMo for topical rails ("stay in the simulated patient role", "no real-patient advice"), Guardrails AI or plain Pydantic for output shape. LLM Guard's repo was archived July 2026 **[unverified]**. ([infrabase](https://infrabase.ai/blog/llm-guardrails-compared), [particula](https://particula.tech/blog/ai-guardrails-compared-nemo-guardrails-ai-llama-guard))

### 1.8 Recommendation

**LangGraph 1.2 + PostgresSaver + Store/LangMem + Langfuse + promptfoo/DeepEval + NeMo Guardrails + Llama Guard 4.** Justification: the Director is a durable, interruptible, long-lived loop with faculty overrides, which is exactly the interrupt/checkpoint model; the Generator is a map-reduce, which is `Send`; both run in the existing FastAPI process with asyncio; memory lives in the same Postgres; Langfuse is MIT and ClickHouse-backed so admin cost views come for free; Pydantic AI remains an option for typed tool-heavy nodes. Vendor SDKs would lock the gateway to one model provider, which conflicts with the open-weight routing in `08`/`11`.

---

## 2. Model access: OpenAI-compatible inference and self-hosting

### 2.1 Lambda Inference API status

- Lambda's inference landing page now reads "As the Inference API winds down, you can continue deploying and scaling models seamlessly on NVIDIA GPU instances." No shutdown date; `api.lambda.ai` not mentioned on that page. ([lambda.ai/inference](https://lambda.ai/inference))
- The docs site has no Inference API section; `docs.lambda.ai/public-cloud/lambda-inference-api/` redirects to its parent and `docs.lambda.ai/api/inference` returns 404. ([docs.lambda.ai](https://docs.lambda.ai/))
- Confusingly, `lambda.ai/inference-models` still lists 30 models (DeepSeek-V4.1-Flash, Nemotron 3.5, GLM-5.3, Kimi K3, MiniMax-M3) with no prices. **[Status of those listings unverified]**. ([LLM index](https://lambda.ai/inference-models))
- Historic prices for reference only: $0.02 to $0.90 per 1M in Dec 2024; Qwen3-32B $0.10/$0.30 in 2025. ([VentureBeat](https://venturebeat.com/ai/lambda-launches-inference-as-a-service-api-claiming-lowest-costs), [Lambda blog](https://lambda.ai/blog/qwen3-32b-is-available-on-lambdas-inference-api))
- **Action**: keep `LAMBDA_API_KEY` support behind a feature flag in `server/` but default routing to DeepInfra, Groq or self-hosted vLLM.

### 2.2 Provider price table (fetched 2026-10-19 unless noted)

| Model | DeepInfra | Together | Groq | Fireworks | HF router / OpenRouter |
|---|---|---|---|---|---|
| Qwen3-32B | $0.08 / $0.28 | n/a | n/a | n/a | pass-through |
| Qwen3-235B-A22B-Instruct-2507 | $0.09 / $0.55 | $0.20 / $0.60 (FP8 throughput) | n/a | n/a | OpenRouter ~$0.09 / $0.55 **[tracker]** |
| Llama-4-Scout-17B-16E | $0.10 / $0.30 | n/a listed | n/a | n/a | Together $0.18 / $0.59 **[tracker]** |
| DeepSeek-V3.2 | $0.26 ($0.13 cached) / $0.38 | n/a | n/a | n/a | OpenRouter ~$0.26-0.28 / $0.42 **[tracker]** |
| DeepSeek-V4-Flash | $0.09 ($0.018 cached) / $0.18 | V4 Flash 0731 $0.14 / $0.28; V4.1 Flash $0.30 / $1.20 | n/a | n/a | |
| DeepSeek-V4-Pro | $1.30 / $2.60 | $1.32 / $3.96 | n/a | ~$1.74 / $3.48 **[tracker]** | |
| gpt-oss-120b | n/a listed (trackers: $0.037 / $0.17) | $0.15 / $0.60 | $0.15 / $0.60, ~500 tok/s | $0.15 / $0.60 **[tracker]** | Bedrock EU via OpenRouter $0.15 / $0.60 |
| gpt-oss-20b | n/a | n/a | $0.075 / $0.30, ~1000 tok/s | | |
| Gemma 3 27B | $0.08 / $0.16 | n/a | n/a | n/a | |
| Llama Guard 4 12B | $0.18 / $0.18 | | listed, price not shown | | |
| Qwen3.8-27B (preview) | | | $0.80 / $4.00 (preview only) | | |

Sources: [DeepInfra pricing](https://deepinfra.com/pricing), [Together pricing](https://www.together.ai/pricing), [Groq models](https://console.groq.com/docs/models), [Fireworks pricing](https://fireworks.ai/pricing) (page shows fine-tuning tiers; serverless rates not on page, so Fireworks numbers are from [pricepertoken](https://pricepertoken.com/endpoints/compare/deepinfra-vs-fireworks) and [beri.net](https://www.beri.net/article/together-vs-fireworks-vs-groq-open-weight-inference-tool-call-accuracy-2026), **[unverified]**), [OpenRouter gpt-oss-120b](https://openrouter.ai/openai/gpt-oss-120b), [tokentab](https://tokentab.dev/pricing/openrouter).

- **HF Inference Providers**: OpenAI-compatible at `https://router.huggingface.co/v1`; "Hugging Face charges you the same rates as the provider, with no additional fees"; free accounts get no credits, PRO $2/mo credits; `X-HF-Bill-To` header for org billing; Enterprise usage API gives daily cost per member/model/provider (useful for the admin panel). Routing suffixes like `:cheapest` select by output price **[suffix syntax from secondary source]**. ([HF pricing](https://huggingface.co/docs/inference-providers/en/pricing), [subconscious review](https://www.subconscious.dev/providers/hugging-face))
- **OpenRouter**: passes provider prices through; fee is 5.5% ($0.80 min) on card credit purchases **[secondary]**. ([betonai guide](https://betonai.net/openrouter-pricing-2026-complete-guide-to-every-model-tier-and-hidden-cost/))

### 2.3 Which open weights are medical-capable and what the licenses say

- **MedGemma**: HF collection holds `medgemma-1.5-4b-it`, `medgemma-4b-it/pt`, `medgemma-27b-text-it`, `medgemma-27b-it` (multimodal), `medsiglip-448`. Only the 4B has a 1.5 release (2026-01-13). MedQA 4-option: MedGemma 1 27B 85.3, MedGemma 1.5 4B 69.1, Gemma 3 4B 50.7. Weights under Health AI Developer Foundations terms; repo code Apache-2.0; "not intended to directly inform clinical diagnosis." ([Collection](https://huggingface.co/collections/google/medgemma-release-680aade845f90bec6a3f60c4), [Model card](https://developers.google.com/health-ai-developer-foundations/medgemma/model-card), [GitHub](https://github.com/google-health/medgemma)) A third-party page claims a "MedGemma 1.5 27B" at 87.7 MedQA; **[unverified, not in Google's collection]**. ([innFactory](https://innfactory.ai/en/ai-models/medgemma/))
- **Gemma 3 27B**: Gemma Terms of Use (custom, commercial allowed, "Built with Gemma" attribution, prohibited-use policy), not Apache; a blog claiming Apache-2.0 conflicts with other sources **[unverified]**. ([canirun license summary](https://www.canirun.ai/license/gemma), [WCR legal](https://wcr.legal/google-gemma-license-risks/))
- **gpt-oss-120b**: Apache-2.0, 117B total / 5.1B active, MXFP4 MoE weights, "run on a single 80GB GPU such as H100 or MI300X", reasoning low/medium/high via system prompt. ([HF](https://huggingface.co/openai/gpt-oss-120b))
- **Qwen3 / Qwen3.5 / Qwen3.8**: Qwen3 and Qwen3.5 sizes are Apache-2.0; Qwen3.8 27B Apache-2.0 while Qwen3.8-Max uses a custom license with revenue sharing above $50M **[secondary]**. ([open-weight-models list](https://github.com/xigh/open-weight-models), [Wikipedia Qwen](https://en.wikipedia.org/wiki/Qwen))
- **Llama 4 Scout/Maverick**: Llama 4 Community License; EU restriction on multimodal use. ([HF blog Llama Guard 4](https://huggingface.co/blog/llama-guard-4), [open-weight-models](https://github.com/xigh/open-weight-models))
- **DeepSeek V3.2 / V4 Flash / V4 Pro**: MIT **[secondary]**. ([wavect](https://wavect.io/blog/open-weight-llm-comparison-2026/))

### 2.4 Self-hosting on one A100 80GB or H100 80GB

- **Engines**: vLLM v0.32.0 (2026-10-18; drops Python 3.10; CORS no longer `*` by default; `max_tokens` no longer reserved from context) and SGLang v0.5.22 (2026-10-19; Python 3.11+; DeepSeek-V4.1 +2.3x per GPU on H200, PD disaggregation). ([vLLM releases](https://github.com/vllm-project/vllm/releases), [SGLang releases](https://github.com/sgl-project/sglang/releases))
- **Quantization support table** (vLLM stable docs, 2026-09-14): AWQ, GPTQ, Marlin (GPTQ/AWQ/FP8/FP4), INT8 W8A8, bitsandbytes on both Ampere and Hopper; **FP8 W8A8 (llm-compressor) is Hopper/Ada only, not A100**. ([vLLM quantization](https://docs.vllm.ai/en/stable/features/quantization/))
- **Fit guidance**:
  - H100 80GB: gpt-oss-120b MXFP4 (native), Qwen3-32B FP8 (~34 GB weights) with long KV, MedGemma 27B BF16 (~54 GB) tight, FP8 comfortable.
  - A100 80GB: Qwen3-32B AWQ INT4 or INT8 W8A8, MedGemma 27B AWQ/GPTQ INT4 or INT8; gpt-oss-120b MXFP4 on Ampere is via Marlin MXFP4 kernels **[A100 MXFP4 performance unverified]**.
- **Throughput**: head-to-head H100 tests put vLLM and SGLang within a few percent (e.g., Llama 3.3 70B FP8 at 50 concurrent: SGLang 1,920 vs vLLM 1,850 tok/s). The only 32B-on-A100 datapoint found is DeepSeek-R1-Distill-Qwen-32B at ~577 tok/s aggregate at 50 concurrent, saturating ~720 tok/s at 300 with ~67 s TTFT, old vLLM; **[not Qwen3, not AWQ]**. Run `vllm bench serve` on your own prompts. ([Spheron](https://www.spheron.network/blog/vllm-vs-tensorrt-llm-vs-sglang-benchmarks/), [jarvislabs](https://jarvislabs.ai/blog/vllm-sglang-trtllm-comparison), [databasemart A100](https://www.databasemart.com/blog/vllm-gpu-benchmark-a100-80gb))
- **Cost of the box**: Lambda on-demand 1x H100 PCIe $3.29/hr, 1x A100 40GB $1.99/hr, 1x GH200 96GB $2.29/hr, 8x A100 80GB $2.79/GPU/hr; DeepInfra custom deployments H100 $2.20/hr, A100 80GB $0.89/hr, B200 $3.69/hr. ([Lambda pricing](https://lambda.ai/pricing), [DeepInfra](https://deepinfra.com/pricing))

---

## 3. Identity and university SSO

### 3.1 Candidate IdPs

| Product | License | SAML | OIDC | Notes | Source |
|---|---|---|---|---|---|
| **Keycloak 26.8.1** (2026-10-13) | Apache-2.0 | Full IdP + broker, step-up supported (26.7), Organizations with per-domain IdP routing (26.8), org groups in SAML assertions (26.6) | Certified | Heaviest to run; best SAML; no native federation metadata ingestion | [26.8.1](https://www.keycloak.org/2026/10/keycloak-2681-released), [26.8.0](https://www.keycloak.org/2026/10/keycloak-2680-released), [26.7.0](https://www.keycloak.org/2026/07/keycloak-2670-released), [26.6.0](https://www.keycloak.org/2026/04/keycloak-2660-released) |
| authentik | MIT core, EE dir separate | IdP: metadata import/export, SSO+SLO, signing/encryption, NameID policies, ForceAuthn (2026.8+) | Yes | Nicer admin UI, lighter ops, SAML less battle-tested than Keycloak | [SAML provider](https://docs.goauthentik.io/add-secure-apps/providers/saml/), [GitHub](https://github.com/goauthentik/authentik), [devhandbook](https://devhandbook.io/blog/2026-08-08-self-hosted-auth-sso-showdown/) |
| ZITADEL | AGPL-3.0 core since v3 (2025-03-31); APIs/SDKs Apache-2.0 | IdP and SP | Certified | Multi-tenant B2B focus; AGPL matters only if you modify and offer as a service | [Apache to AGPL](https://zitadel.com/blog/apache-to-agpl), [v3](https://zitadel.com/blog/zitadel-v3-announcement) |
| Ory Kratos/Hydra | Apache-2.0 **[license not restated on new docs page]** | Not in core | Hydra certified OIDC | Headless, bring-your-own-UI, single binary + RDBMS | [Ory Identities](https://www.ory.com/docs/identities) |
| Logto | MPL-2.0 **[secondary]** | Enterprise SSO is a $48/connector add-on on Pro ($24/mo); Free 50k MAU without SSO/orgs | Yes | DX-first | [Pricing](https://logto.io/pricing) |
| SuperTokens | Self-host free, no MAU limit; cloud $0.02/MAU after 5k free | SAML via BoxyHQ Jackson bridge; MFA $0.01/MAU ($100 min) | Yes | Multi-tenancy priced on request | [Pricing](https://supertokens.com/pricing) |
| Supabase Auth | Managed (Postgres-backed) | SAML 2.0 on Pro+, 50 SSO MAU included then $0.015/SSO MAU; no SLO; IdP-initiated needs workaround with PKCE | Yes | Free 50k MAU; Pro $25/mo 100k MAU then $0.00325/MAU | [Pricing](https://supabase.com/pricing), [SAML docs](https://supabase.com/docs/guides/auth/enterprise-sso/auth-sso-saml) |
| Clerk | Managed | 1 SAML connection on Pro ($25/mo), extra $75/mo each (2 to 15) | Yes | 50k free MRU, $0.02/MRU to 100k; orgs 100 free then $1/MRO | [Pricing](https://clerk.com/pricing) |
| Pipedream Connect | Managed | Not an IdP | Not an IdP | Managed OAuth for 3,000+ third-party apps keyed by your `external_user_id`; proxy, MCP, triggers; docs point to Clerk/Firebase/Auth0 for your own user login | [Connect docs](https://pipedream.com/docs/connect), [Managed auth](https://pipedream.com/docs/connect/managed-auth/quickstart) |

### 3.2 University SSO: SAML/OIDC, Shibboleth, eduGAIN

- Universities federate through national federations into eduGAIN; SPs join via their national federation, publish SAML metadata, and request REFEDS entity categories (R&S / Personalized) to receive attributes. ([eduGAIN join](https://edugain.org/about-edugain/join-edugain/)) **[page content not fetched; description from general knowledge, verify]**
- Stock Keycloak has "no support for an automated processing of ... SAML2 based federation metadata" and emits per-IdP SP metadata, which federations do not expect. Options: (1) run a Shibboleth SP or SATOSA + pyFF proxy in front and present one IdP to Keycloak; (2) onboard each partner university manually as one SAML IdP in Keycloak via metadata URL (fine for the first 5 to 20 schools); (3) a community Keycloak fork imports federation metadata but is not upstream. ([Keycloak forum](https://forum.keycloak.org/t/using-keycloak-with-shibboleth-wayf-samlds/8609), [GitHub discussion](https://github.com/keycloak/keycloak/discussions/8608), [jboss list](https://lists.jboss.org/pipermail/keycloak-user/2019-July/018856.html))
- Keycloak SAML broker supports AuthnContext requests, SP descriptor export, "send subject", first-login flows with account linking. ([Server admin guide](https://www.keycloak.org/docs/latest/server_admin/index.html#_identity_broker_saml))

### 3.3 LTI 1.3

- **ltijs** (Node): Apache-2.0, v7 TypeScript rewrite, launches, Deep Linking, AGS, NRPS, Dynamic Registration; needs a database (MongoDB example, Firestore plugin). ([GitHub](https://github.com/Cvmcosta/ltijs), [npm 7.0.6](https://libraries.io/npm/ltijs))
- **pylti1.3 / pylti1p3** (Python): MIT, Django and Flask adapters, OIDC login, deep linking, NRPS, AGS; maintainer "unable to maintain ... beyond occasional bugfixes"; Instructure community reports no updates for years. **django-lti** (UM Center for Academic Innovation) is the active wrapper but depends on pylti1p3. ([GitHub](https://github.com/dmitry-viskov/pylti1.3), [django-lti issue #108](https://github.com/academic-innovation/django-lti/issues/108), [Instructure thread](https://community.instructure.com/en/discussion/654723/status-of-pylti1-3))
- **AcuDx choice**: implement the LTI tool as a small Node service with ltijs (it only needs to validate launches and post grades via AGS) or fork pylti1p3 into `server/lti/` if staying pure Python. LTI 1.3 is OIDC-based, so university SAML stays in the identity layer, not the tool.

### 3.4 Recommendation and role model

- **Open-source default**: Keycloak 26.8.x in Docker next to Postgres, one realm, Organizations enabled, one Organization per institution with its SAML/OIDC IdP and verified email domains (26.8 per-domain routing). FastAPI validates Keycloak JWTs; React uses OIDC PKCE.
- **Managed option**: Supabase Auth (cheapest, SAML on Pro, no SLO) or Clerk (better B2B UI, pricier SAML). Both can brokerage university IdPs one at a time; neither handles eduGAIN metadata.
- **Roles** (Keycloak realm roles, mirrored as JWT claim `roles`, plus Organization membership for tenancy):

| Role | Scope | Can do |
|---|---|---|
| `student` | own org | run cases, see own feedback and memory |
| `resident` | own org | student plus advanced cases, peer review of students if `cohort_lead` |
| `nurse` | own org | nursing-track cases, handover sims |
| `paramedic` | own org | prehospital track, time-critical sims |
| `faculty` (academician) | own org | author/approve cases (interrupt gate), view cohort analytics, grade overrides |
| `dean` | own org | org-wide analytics, cost dashboard for the org, manage faculty |
| `admin` | own org | org settings, IdP config, LTI keys, user management |
| `super-admin` | platform | all orgs, model routing, price table, telemetry, feature flags |

Use composite roles (`faculty` includes `resident` includes `student`) and Keycloak Organization groups so group membership lands in tokens automatically (26.6+). ([26.6.0](https://www.keycloak.org/2026/04/keycloak-2660-released))

---

## 4. One-click deploy and domain mapping

### 4.1 "Paste a domain, get TLS": who actually does it

| Platform | Domain + TLS flow | Verdict | Source |
|---|---|---|---|
| **Coolify** (self-host PaaS) | Point DNS at server, set `https://your.domain` on the resource's Domains page, redeploy; Traefik or Caddy issues and renews Let's Encrypt; wildcard via server-level Wildcard Domain + DNS challenge guide | Yes | [Domains](https://coolify.io/docs/knowledge-base/domains) |
| **Dokploy** | Add Domain, toggle HTTPS, choose `letsencrypt`; Traefik file-provider per domain with HTTP to HTTPS redirect; free traefik.me domains are HTTP only; Compose apps need redeploy on domain change | Yes | [Domains](https://docs.dokploy.com/docs/core/domains) |
| **CapRover** v1.15.4 (2026-08-30) | nginx + Let's Encrypt from UI; Docker Swarm | Yes, older design | [Releases](https://github.com/caprover/caprover/releases), [Zaira guide](https://zairalabs.ai/guide/tools/caprover/) |
| **Railway** | Settings > Networking > Public Networking, add CNAME + TXT; "free SSL certificates ... provisioned and renewed automatically" | Yes | [Public networking](https://docs.railway.com/guides/public-networking) |
| **Render** | Add Custom Domain, DNS, Verify; auto TLS incl. wildcards (3 CNAMEs); Hobby 2 domains, Pro 15, Scale 25, then $0.25/domain/mo; remove AAAA records | Yes | [Custom domains](https://render.com/docs/custom-domains) |
| **Fly.io** | `fly certs add example.com`; A/AAAA (or CNAME for subdomains); Let's Encrypt via TLS-ALPN/HTTP-01, DNS-01 for wildcard; Cloudflare proxy needs Full (Strict) | Yes | [Custom domain](https://docs.fly.io/networking/custom-domain) |
| **Vercel** (+ Supabase) | Add domain in project Settings > Domains or `vercel domains add`; A record for apex, CNAME for subdomain; wildcard needs Vercel nameservers or `_acme-challenge` NS delegation; Hobby 50 domains/project | Yes for the web/ SPA; FastAPI gateway must live elsewhere | [Add a domain](https://vercel.com/docs/domains/working-with-domains/add-a-domain) |
| **AWS App Runner** | ACM validation CNAMEs + DNS target; up to 5 custom domains | **Closed to new customers**; AWS recommends ECS Express Mode | [Custom domains](https://docs.aws.amazon.com/apprunner/latest/dg/manage-custom-domains.html) |
| **Docker Compose + Caddy** | `example.com { reverse_proxy api:8000 }`; Caddy gets certs from Let's Encrypt or ZeroSSL, needs ports 80/443 and persistent `/data`; on-demand TLS for unknown tenant domains with an `ask` endpoint | Yes, zero vendor | [Automatic HTTPS](https://caddyserver.com/docs/automatic-https) |
| **Cloudflare Tunnel** | `cloudflared` outbound only; dashboard route "Published application" maps hostname to `http://localhost:8000`; TLS terminated at Cloudflare edge; Access policies optional (paid seats only if you want IdP-gated access) | Yes, no inbound ports; origin stays HTTP | [Create tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-remote-tunnel/), [Routing](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/routing-to-tunnel/) |

Pricing context (secondary, verify on vendor pages): Railway Hobby $5/mo with $5 usage, Render free tier sleeps after ~15 min idle with paid from ~$7/mo, Fly.io per-second with no base fee and no free tier for new accounts. ([dev.to comparison](https://dev.to/pavel-hostim/render-vs-railway-vs-flyio-pricing-compared-2026-2e5p), [bex.co](https://bex.co/blog/2026/10/14/railway-vs-render-vs-flyio-solo-developer-hidden-costs))

**Recommendation**: ship `deploy/docker-compose.yml` with Caddy as the reference path (the only dependency is a VM and a DNS record), plus a Coolify template (one-click on the user's own server, same Compose file) and a Railway template for the no-server path. Document Cloudflare Tunnel as the option for campuses that will not open inbound ports.

### 4.2 GPU side: Lambda Cloud API for a vLLM + TTS + avatar worker

- **Base URL** `https://cloud.lambda.ai/api/v1`, `Authorization: Bearer <key>` (Basic auth with key as username still accepted). ([Cloud API](https://docs.lambda.ai/api/cloud))
- **Launch**: `POST /instance-operations/launch` with required `region_name`, `instance_type_name`, `ssh_key_names` (exactly one); optional `file_system_names` or `file_system_mounts` (mount_point + file_system_id), `firewall_rulesets` (ids, same region), `hostname`, `name`, `image` (id or family), `user_data` (cloud-init, up to 1 MB), `tags`. States: booting, active, unhealthy, terminated, terminating, preempted. ([Cloud API](https://docs.lambda.ai/api/cloud))
- **Instance types**: `GET /instance-types` returns specs, price in US cents/hr and regions with capacity; use it to pick `gpu_1x_h100_pcie` or an A100 type at runtime rather than hardcoding **[exact type-name strings not confirmed on this page]**.
- **Firewall**: default only port 22 open; `GET/PUT /firewall-rules` (account-wide inbound rules), `GET/POST/PATCH/DELETE /firewall-rulesets` plus `/firewall-rulesets/global`; per-instance rulesets must be attached at launch (up to 128 per workspace); rules do not apply in us-south-1. ([Firewalls](https://docs.lambda.ai/public-cloud/firewalls/), [Cloud API](https://docs.lambda.ai/api/cloud))
- **Filesystems**: `GET/POST /filesystems` (name + region), `DELETE /filesystems/{id}` when unmounted; attach at launch; same region; max 24. Keep model weights (vLLM cache, TTS voices, avatar checkpoints) on a filesystem so cold starts skip the download. ([Cloud API](https://docs.lambda.ai/api/cloud))
- **SSH keys**: `POST /ssh-keys` without `public_key` makes Lambda generate a pair; it does not retain the private key. **Terminate/restart**: `POST /instance-operations/terminate|restart` with `instance_ids`.
- **Worker pattern**: `user_data` cloud-init pulls `ghcr.io/<org>/acudx-gpu-worker`, mounts `/lambda/nfs/models`, starts vLLM (`--quantization fp8` on H100, `awq_marlin` on A100), the TTS server and the avatar renderer behind one Caddy on 443 with a firewall ruleset that allows 443 only from the gateway's IP, and registers itself with the gateway via a signed callback. Terminate on idle via the gateway's scheduler to control the $3.29/hr meter.

---

## 5. Telemetry for the admin panel and per-call cost

### 5.1 Options

| Stack | Strengths | Gaps | Source |
|---|---|---|---|
| **OpenTelemetry + Grafana (Tempo/Loki/Prometheus or Grafana Cloud AI Observability)** | Vendor-neutral; one collector fans out; Grafana Cloud OpenLIT integration ships GenAI, evaluations, agent, VectorDB, MCP and GPU dashboards with spend and token tracking | GenAI semconv still Development-stability (names can change); cost needs your own price table; conventions moved to a dedicated repo | [Grafana AI Observability](https://grafana.com/docs/grafana-cloud/monitor-applications/ai-observability/), [Grafana blog](https://grafana.com/blog/ai-observability-llms-in-production/), [semconv-genai repo](https://github.com/open-telemetry/semantic-conventions-genai), [dev.to semconv](https://dev.to/gabrielanhaia/opentelemetry-genai-semantic-conventions-your-llm-traces-should-look-like-this-in-2026-3ff6) |
| **Langfuse (ClickHouse-backed)** | Per-generation cost: ingested `cost_details` win, else `usage_details` x model `match_pattern` price, user-defined models override built-ins, pricing tiers, cached tokens as separate exclusive buckets (`input_cached_tokens`); OTLP/HTTP ingest; cost by model/user/session out of the box | Not an infra monitor; reasoning tokens need ingested counts | [Model usage and cost](https://langfuse.com/docs/model-usage-and-cost), [Self-hosting](https://langfuse.com/self-hosting) |
| **ClickHouse + PostHog AI Observability** | Captures prompt, response, tokens, cost, latency, tools per LLM call; links trace to user, session replay and exceptions; ingests from Langfuse/Helicone/Traceloop; product analytics in the same tool | Per-event pricing and cost formula not on the overview page **[unverified]**; self-host is the hobby deployment only | [PostHog](https://posthog.com/docs/llm-analytics), [PostHog blog](https://posthog.com/blog/best-ai-observability-tools) |

### 5.2 Recommendation

1. In `server/` wrap every provider call in one `gen_ai.*` span (request model, response model as actually served, provider, input/output/cached tokens, `acudx.org_id`, `acudx.user_id`, `acudx.encounter_id`, `acudx.agent` = generator|director|judge). Capture both requested and served model since providers substitute. ([OTel semconv guide](https://openobserve.ai/blog/opentelemetry-genai-semantic-conventions/))
2. Compute `cost_usd` in the gateway from a versioned `price_table.yaml` (provider, model regex, input, output, cached input, effective_from) and attach it as an attribute; send it to Langfuse as `cost_details` so Langfuse does not re-infer. Do not derive totals from histograms. ([Langfuse cost](https://langfuse.com/docs/model-usage-and-cost))
3. OTel Collector exports to Langfuse (`/api/public/otel`, HTTP) and to Tempo/Prometheus/Loki (or Grafana Cloud). Admin panel reads cost per org/user/model from Langfuse's API or directly from its ClickHouse, and GPU utilization and Lambda hourly spend from Prometheus (DCGM exporter on the worker plus a small exporter that polls `GET /instances`).
4. Optional: PostHog for product funnels and session replay; forward Langfuse traces to it only if the team wants one UI.

---

## 6. Open questions and items to verify before committing

- Lambda Inference API end date and whether `api.lambda.ai` still answers; confirm with Lambda support. ([lambda.ai/inference](https://lambda.ai/inference))
- Langfuse v4 minimum versions and current release number (sources disagree: v4.21.0 vs 4.3.1 images). ([Railway template](https://railway.com/deploy/langfuse-v4--langfuse-observability), [sakutto](https://sakutto.ai/en/articles/langfuse))
- Fireworks and Groq serverless price pages were not readable (403/404); numbers above for those two come from Groq's model docs and third-party trackers.
- MXFP4 gpt-oss-120b performance on A100 (Marlin MXFP4 path).
- Microsoft Agent Framework GA and AutoGen maintenance dates from microsoft.com.
- eduGAIN join page content was not fetched; confirm national federation process (for Turkey: YETKİM) with the federation operator.
