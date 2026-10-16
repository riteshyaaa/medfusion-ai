# Optional provider explanations

Provider capabilities and data-use notes were checked against official documentation on 2026-10-15. These integrations add one bounded task: produce a short educational explanation of an existing, approved Skin Analysis classifier result. They do not classify images, create or revise numeric scores, access symptoms or patient profiles, or make treatment recommendations.

## Current state

- **AI_PROVIDER=none** is the default. No API credential is configured in this repository.
- The API requires an owner-scoped completed prediction, per-request **consentToExternalProcessing=true**, and both server flags **AI_DATA_SHARING_ENABLED=true** and **AI_HEALTH_DATA_TRANSFER_APPROVED=true**.
- The application currently has no promoted production inference provider. The trained PAD-UFES-20 checkpoint is marked **research_only_not_approved**; **/api/ai/explanations** therefore returns **model_unavailable** before any provider request.
- Provider adapters are exercised with mocked HTTP responses only. No provider account or live credential was used.
- The explanation is ephemeral. The response keeps the classifier record separate and unchanged. The existing audit event records the authenticated actor plus standard request metadata, and stores provider/model identifiers on success or a generic error code on failure. It does not include a prediction resource ID. The text itself, scores, labels, images, symptoms, and patient identifiers are not logged or persisted by this route.

## Supported adapters

| Provider setting | Allowlisted model | API task and endpoint | Output validation |
| --- | --- | --- | --- |
| **openai** | **gpt-5.5** | Responses API **/v1/responses**; text-only request, **store=false**, strict JSON Schema output. | Provider structured output plus local strict Zod parsing. |
| **gemini** | **gemini-3.8-flash** | Interactions API **/v1/interactions**; text-only request, **store=false**, structured **response_format**. | Provider structured output plus local strict Zod parsing. |
| **nvidia** | **openai/gpt-oss-20b** | NVIDIA-hosted Chat Completions at **https://integrate.api.nvidia.com/v1/chat/completions**. This is an OpenAI-origin model hosted by NVIDIA. | Prompt requests JSON; local strict Zod parsing is authoritative. Hosted structured-output support was not assumed. |

Provider models are an explicit allowlist, not user input. Update the list only after rechecking official API support, terms, account access, and structured-output behavior. Each request has a timeout, at most two retries for retryable transport/5xx/429 failures, bounded process concurrency, a 128 KiB provider-response cap, and an API rate limit. Credentials stay server-side.

The adapter sends only classifier model ID/version, score semantics, candidate labels, and candidate scores. OpenAI and Gemini receive a strict schema. NVIDIA does not receive provider-specific response_format because its hosted model support for that feature was not verified. All returned text must be valid JSON matching the local schema; text containing numeric characters or percentages is rejected so the provider cannot supply or restate classifier scores.

## Data handling and provider terms

**store=false** requests stateless behavior from OpenAI Responses and Gemini Interactions. It is not a general promise that the provider retains no data:

- OpenAI states API data is not used for model training by default unless an organization opts in. Its documentation describes up to 30 days of abuse-monitoring retention by default; **store=false** disables default Responses application-state storage but does not by itself disable abuse monitoring.
- Gemini Interactions stores interaction objects by default (55 days for paid tier and 1 day for free tier in the current documentation); this adapter sets **store=false**. Google's terms differ between unpaid and paid services: unpaid-service prompts and responses may be used to improve products, while paid-service prompts and responses are not used for product improvement under the current terms. Review the actual account, billing tier, terms, and retention configuration before enabling transfer.
- NVIDIA’s hosted Build model page states that trial input and output are recorded to provide the trial and improve NVIDIA products and services, and says not to upload confidential or personal information unless expressly permitted. Do not enable this adapter for health-related data on that trial path unless the applicable current terms expressly permit the intended use.

These notes are not a compliance assessment. The server-side approval flag is an operator control; setting it does not establish consent, a lawful basis, a contractual safeguard, regulatory compliance, or suitability for identifiable health data. The route is not exposed in the UI yet.

## Configuration

Copy **.env.example** to a local .env only when needed; never commit .env or credentials.

~~~dotenv
AI_PROVIDER=none
AI_MODEL=
AI_DATA_SHARING_ENABLED=false
AI_HEALTH_DATA_TRANSFER_APPROVED=false
AI_REQUEST_TIMEOUT_MS=15000
AI_MAX_RETRIES=1
AI_MAX_CONCURRENCY=2
AI_RATE_LIMIT=10
AI_RATE_LIMIT_WINDOW_MS=60000
~~~

Select one supported provider and set only that provider’s server key (**OPENAI_API_KEY**, **GEMINI_API_KEY**, or **NVIDIA_API_KEY**). Optional HTTPS base URL overrides are **OPENAI_BASE_URL**, **GEMINI_BASE_URL**, and **NVIDIA_BASE_URL**; non-HTTPS endpoints are rejected. The route still requires explicit user consent and an approved model.

## Official sources

- [OpenAI GPT-5.5 model and endpoint support](https://developers.openai.com/api/docs/models/gpt-5.5)
- [OpenAI Responses API reference](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI data controls and retention](https://developers.openai.com/api/docs/guides/your-data)
- [Gemini Interactions API reference](https://ai.google.dev/api/interactions-api-v1)
- [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)
- [Gemini 3.8 Flash model](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)
- [Gemini Interactions retention](https://ai.google.dev/gemini-api/docs/interactions-overview#data-storage-retention)
- [Gemini API terms](https://ai.google.dev/gemini-api/terms)
- [Gemini data logging and sharing](https://ai.google.dev/gemini-api/docs/logs-policy)
- [NVIDIA-hosted gpt-oss-20b model and trial privacy notice](https://build.nvidia.com/openai/gpt-oss-20b)
- [NVIDIA NIM API reference](https://docs.nvidia.com/nim/large-language-models/latest/reference/api-reference.html)
