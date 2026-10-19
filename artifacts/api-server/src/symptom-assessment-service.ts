import { HTTPException } from "hono/http-exception";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { cases, symptomAssessments, symptomAiEvaluations } from "@workspace/db/schema";
import { AIProviderError, externalHealthDataTransferEnabled } from "./ai-providers";
import { getClinicalAIProvider, SYMPTOM_EVALUATION_PROMPT_VERSION } from "./clinical-ai";
import { classifySymptoms, getSymptomCatalogueIds, getSymptomClassifierStatus } from "./symptom-classifier";
import { assessSymptomGuidance, SYMPTOM_RULE_SET_VERSION, urgencyStateFor, type SymptomGuidance, type UrgencyState } from "./symptom-guidance";
import {
  applyFollowUpAnswers,
  FOLLOW_UP_QUESTION_SET_VERSION,
  validateFollowUpAnswers,
  type FollowUpAnswer,
} from "./symptom-questions";

export const SYMPTOM_INPUT_SCHEMA_VERSION = "symptom-input-v2";

export type SymptomCategoryName = "skin" | "general" | "neurological" | "cardiovascular" | "respiratory" | "gastrointestinal" | "musculoskeletal" | "psychiatric" | "other";

export type SymptomAssessmentPayload = {
  caseId?: number;
  consentToExternalProcessing?: boolean;
  primarySymptom: string;
  symptomCategory: SymptomCategoryName;
  onset?: string;
  duration?: string;
  severity?: "mild" | "moderate" | "severe";
  progression?: "improving" | "stable" | "worsening" | "fluctuating";
  associatedSymptoms: string[];
  medicalHistory: string[];
  medications: string[];
  allergies: string[];
  selectedSymptoms: string[];
  ageGroup?: "child" | "adolescent" | "adult" | "older_adult" | "unknown" | "prefer_not_to_say";
  factorsThatHelp: string[];
  factorsThatWorsen: string[];
  previousEpisodes?: "first_episode" | "recurrent" | "unknown";
  additionalNotes?: string;
  questionnaireAnswers: FollowUpAnswer[];
};

export type NormalizedSymptomAssessmentInput = SymptomAssessmentPayload & {
  deduplicatedSymptomIds: string[];
};

function normalizeTextKey(value: string): string {
  return value.toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function dedupeStrings(values: string[]): { values: string[]; removed: number } {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const value of values) {
    const key = normalizeTextKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kept.push(value);
  }
  return { values: kept, removed: values.length - kept.length };
}

export function normalizeSymptomAssessmentInput(input: SymptomAssessmentPayload): NormalizedSymptomAssessmentInput {
  const catalogueIds = getSymptomCatalogueIds() ?? [];
  const catalogueIndex = new Map(catalogueIds.map((id) => [normalizeTextKey(id), id]));

  const dedupedSymptoms = dedupeStrings(input.selectedSymptoms.map((value) => value.trim()).filter(Boolean));
  const canonicalSymptoms = dedupedSymptoms.values.map((value) => catalogueIndex.get(normalizeTextKey(value)) ?? value);
  const dedupedAssociated = dedupeStrings(input.associatedSymptoms.map((value) => value.trim()).filter(Boolean));
  const dedupedHistory = dedupeStrings(input.medicalHistory.map((value) => value.trim()).filter(Boolean));
  const dedupedMedications = dedupeStrings(input.medications.map((value) => value.trim()).filter(Boolean));
  const dedupedAllergies = dedupeStrings(input.allergies.map((value) => value.trim()).filter(Boolean));
  const dedupedHelp = dedupeStrings(input.factorsThatHelp.map((value) => value.trim()).filter(Boolean));
  const dedupedWorsen = dedupeStrings(input.factorsThatWorsen.map((value) => value.trim()).filter(Boolean));

  return {
    ...input,
    selectedSymptoms: canonicalSymptoms,
    associatedSymptoms: dedupedAssociated.values,
    medicalHistory: dedupedHistory.values,
    medications: dedupedMedications.values,
    allergies: dedupedAllergies.values,
    factorsThatHelp: dedupedHelp.values,
    factorsThatWorsen: dedupedWorsen.values,
    deduplicatedSymptomIds: dedupedSymptoms.values.filter((value) => catalogueIndex.has(normalizeTextKey(value))),
  };
}

export type SymptomAiDecision =
  | { attempt: true }
  | { attempt: false; status: "skipped_urgent" | "not_requested" | "unavailable"; notice: string; errorCode?: string };

export function decideSymptomAiProcessing(input: {
  consentToExternalProcessing: boolean;
  urgencyLevel: string;
  providerStatus: "disabled" | "unconfigured" | "misconfigured" | "configured" | "test";
}): SymptomAiDecision {
  if (input.urgencyLevel === "emergency" || input.urgencyLevel === "urgent") {
    return {
      attempt: false,
      status: "skipped_urgent",
      notice: "Urgent warning symptoms matched. No AI model was called. Contact local emergency services or seek immediate care now; do not wait for this application.",
    };
  }
  if (!input.consentToExternalProcessing) {
    return { attempt: false, status: "not_requested", notice: "No external processing consent was given, so no AI evaluation was requested." };
  }
  if (!externalHealthDataTransferEnabled()) {
    return {
      attempt: false,
      status: "unavailable",
      errorCode: "external_processing_disabled",
      notice: "External health-data processing is disabled by server configuration, so no AI evaluation ran. The assessment itself was saved.",
    };
  }
  if (input.providerStatus !== "configured" && input.providerStatus !== "test") {
    return {
      attempt: false,
      status: "unavailable",
      errorCode: "provider_unavailable",
      notice: "No AI provider is configured on the server, so no AI evaluation ran. The assessment itself was saved.",
    };
  }
  return { attempt: true };
}

type AssessmentRow = typeof symptomAssessments.$inferSelect;
type EvaluationRow = typeof symptomAiEvaluations.$inferSelect;

export function symptomEvaluationView(row: EvaluationRow) {
  return {
    id: row.id,
    assessmentId: row.assessmentId,
    provider: row.provider,
    model: row.model,
    promptVersion: row.promptVersion,
    status: row.status,
    errorCode: row.errorCode,
    consentAt: row.consentAt,
    result: row.result,
    createdAt: row.createdAt,
  };
}

export function buildSymptomEvaluationInput(assessment: AssessmentRow) {
  const guidance = (assessment.guidance ?? {}) as {
    recommendations?: string[];
    watchFor?: string[];
    seekCareIf?: string[];
    possibleConditions?: Array<{ name: string; basis: string }>;
    disclaimer?: string;
  };
  const questionnaireAnswers = assessment.questionnaireAnswers ?? [];
  const questionnaireSummary = questionnaireAnswers.map((row) => `${row.questionId}: ${row.answer}`);
  return {
    primarySymptom: assessment.primarySymptom,
    symptomCategory: assessment.symptomCategory,
    ...(assessment.onset ? { onset: assessment.onset } : {}),
    ...(assessment.duration ? { duration: assessment.duration } : {}),
    ...(assessment.severity ? { severity: assessment.severity } : {}),
    ...(assessment.progression ? { progression: assessment.progression } : {}),
    associatedSymptoms: assessment.associatedSymptoms ?? [],
    selectedSymptoms: assessment.selectedSymptoms ?? [],
    medicalHistory: assessment.medicalHistory ?? [],
    medications: assessment.medications ?? [],
    allergies: assessment.allergies ?? [],
    ...(assessment.ageGroup ? { ageGroup: assessment.ageGroup } : {}),
    factorsThatHelp: (assessment as { factorsThatHelp?: string[] }).factorsThatHelp ?? [],
    factorsThatWorsen: (assessment as { factorsThatWorsen?: string[] }).factorsThatWorsen ?? [],
    ...(assessment.previousEpisodes ? { previousEpisodes: assessment.previousEpisodes } : {}),
    ...(assessment.additionalNotes ? { additionalNotes: assessment.additionalNotes } : {}),
    ...(questionnaireSummary.length > 0 ? { questionnaireAnswers: questionnaireSummary } : {}),
    urgencyLevel: assessment.urgencyLevel,
    redFlags: assessment.redFlagsTriggered ?? [],
    guidance: {
      recommendations: guidance.recommendations ?? [],
      watchFor: guidance.watchFor ?? [],
      seekCareIf: guidance.seekCareIf ?? [],
      possibleConditions: guidance.possibleConditions ?? [],
      disclaimer: guidance.disclaimer ?? "",
    },
  };
}

export async function persistSymptomEvaluation(params: {
  assessmentId: number;
  userId: number;
  provider: string;
  model: string;
  promptVersion: string;
  status: "completed" | "failed";
  result?: Record<string, unknown>;
  errorCode?: string;
  consentAt: Date;
  consentEventId: string;
}): Promise<EvaluationRow> {
  const [row] = await db.insert(symptomAiEvaluations).values({
    assessmentId: params.assessmentId,
    userId: params.userId,
    provider: params.provider,
    model: params.model,
    promptVersion: params.promptVersion,
    status: params.status,
    ...(params.result ? { result: params.result } : {}),
    ...(params.errorCode ? { errorCode: params.errorCode } : {}),
    consentAt: params.consentAt,
    consentEventId: params.consentEventId,
  }).returning();
  return row;
}

const providerFailureMessages: Record<string, string> = {
  provider_timeout: "The analysis engine did not respond in time. The assessment was saved; you can retry the evaluation.",
  provider_rate_limited: "The analysis engine is busy right now. The assessment was saved; you can retry shortly.",
  provider_invalid_credentials: "The analysis engine rejected the server credentials. The assessment was saved; contact the administrator.",
  provider_unavailable: "The analysis engine is temporarily unavailable. The assessment was saved; you can retry the evaluation.",
  provider_malformed_response: "The analysis engine returned an unusable response. The assessment was saved; you can retry the evaluation.",
  provider_request_rejected: "The analysis engine rejected this request. The assessment was saved; you can retry the evaluation.",
};

export const AI_UNAVAILABLE_MESSAGE = "The analysis engine did not run. The assessment was saved.";

export type SymptomAssessmentOutcome = {
  assessment: AssessmentRow;
  urgencyState: UrgencyState;
  evaluation?: ReturnType<typeof symptomEvaluationView>;
  aiStatus: "completed" | "failed" | "skipped_urgent" | "not_requested" | "unavailable";
  aiErrorCode?: string;
  aiMessage?: string;
};

type AuditFn = (eventType: string, action: string, outcome: "success" | "failure" | "error", resourceType?: string, resourceId?: string, metadata?: Record<string, unknown>) => Promise<void>;

function buildAiAssessmentSnapshot(params: {
  status: "completed" | "failed" | "skipped_urgent" | "unavailable";
  result?: Record<string, unknown> | null;
  provider?: string;
  model?: string;
  promptVersion?: string;
  errorCode?: string;
  redFlags: string[];
  notice: string;
}) {
  const result = (params.result ?? {}) as Partial<{
    summary: string;
    possibleConsiderations: Array<{ name: string; whyDiscussed: string }>;
    uncertainty: string;
  }>;
  return {
    status: params.status,
    ...(params.provider ? { provider: params.provider } : {}),
    ...(params.model ? { model: params.model } : {}),
    ...(params.promptVersion ? { promptVersion: params.promptVersion } : {}),
    ...(params.errorCode ? { errorCode: params.errorCode } : {}),
    ...(result.summary ? { summary: result.summary } : {}),
    ...(result.possibleConsiderations
      ? { possibleExplanations: result.possibleConsiderations.map((row) => ({ explanation: row.name, whyItMayFit: row.whyDiscussed })) }
      : {}),
    ...(result.uncertainty ? { uncertainty: result.uncertainty } : {}),
    suggestedNextSteps: [],
    warningSigns: params.redFlags,
    notice: params.notice,
  };
}

export async function orchestrateSymptomAssessment(params: {
  userId: number;
  input: SymptomAssessmentPayload;
  audit: AuditFn;
}): Promise<SymptomAssessmentOutcome> {
  const { userId, input, audit } = params;

  if (input.caseId) {
    const caseData = await db.query.cases.findFirst({ where: and(eq(cases.id, input.caseId), eq(cases.createdById, userId)) });
    if (!caseData) throw new HTTPException(404, { message: "Case not found" });
  }

  try {
    validateFollowUpAnswers(input.questionnaireAnswers);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (reason.startsWith("unknown_question")) throw new HTTPException(400, { message: `Unknown follow-up question identifier: ${reason.split(":")[1]}` });
    if (reason.startsWith("duplicate_question")) throw new HTTPException(400, { message: `Duplicate follow-up answer for question: ${reason.split(":")[1]}` });
    throw new HTTPException(400, { message: `Invalid answer for follow-up question: ${reason.split(":")[1]}` });
  }

  await getSymptomClassifierStatus();

  const normalized = normalizeSymptomAssessmentInput(input);
  const applied = applyFollowUpAnswers(normalized.questionnaireAnswers);
  const guidance: SymptomGuidance = assessSymptomGuidance({
    primarySymptom: normalized.primarySymptom,
    symptomCategory: normalized.symptomCategory,
    ...(normalized.severity ? { severity: normalized.severity } : {}),
    ...(normalized.progression ? { progression: normalized.progression } : {}),
    associatedSymptoms: normalized.associatedSymptoms,
    selectedSymptoms: normalized.selectedSymptoms,
    ...(normalized.onset ? { onset: normalized.onset } : {}),
    ...(normalized.duration ? { duration: normalized.duration } : {}),
    medicalHistory: normalized.medicalHistory,
    medications: normalized.medications,
    followUpEvidence: applied.evidence,
    followUpEscalations: applied.escalations,
  });
  const classification = classifySymptoms({ selectedSymptoms: normalized.selectedSymptoms });
  const urgencyState = urgencyStateFor(guidance.urgencyLevel, classification.status);

  const ai = getClinicalAIProvider();
  const decision = decideSymptomAiProcessing({
    consentToExternalProcessing: input.consentToExternalProcessing ?? false,
    urgencyLevel: guidance.urgencyLevel,
    providerStatus: ai.status,
  });

  let aiAssessment: NonNullable<AssessmentRow["classification"]>["aiAssessment"] = null;
  if (decision.attempt === false) {
    if (decision.status === "skipped_urgent") {
      aiAssessment = {
        status: "skipped_urgent",
        warningSigns: guidance.redFlagsTriggered,
        notice: decision.notice,
      };
    } else if (decision.status === "unavailable") {
      aiAssessment = buildAiAssessmentSnapshot({
        status: "unavailable",
        errorCode: decision.errorCode,
        redFlags: guidance.redFlagsTriggered,
        notice: decision.notice,
      });
    }
  }
  let classificationValue = { ...classification, aiAssessment };

  const { consentToExternalProcessing: _consent, deduplicatedSymptomIds: _dedupeNote, ...record } = normalized;
  void _consent;
  void _dedupeNote;
  const [assessment] = await db.insert(symptomAssessments).values({
    ...record,
    userId,
    redFlagsTriggered: guidance.redFlagsTriggered,
    urgencyLevel: guidance.urgencyLevel,
    guidance: {
      recommendations: guidance.recommendations,
      watchFor: guidance.watchFor,
      seekCareIf: guidance.seekCareIf,
      possibleConditions: guidance.possibleConditions,
      disclaimer: guidance.disclaimer,
    },
    questionnaireVersion: FOLLOW_UP_QUESTION_SET_VERSION,
    inputSchemaVersion: SYMPTOM_INPUT_SCHEMA_VERSION,
    ruleSetVersion: SYMPTOM_RULE_SET_VERSION,
    normalizedInput: normalized as unknown as Record<string, unknown>,
    classification: classificationValue,
  }).returning();

  const outcome: SymptomAssessmentOutcome = { assessment, urgencyState, aiStatus: decision.attempt ? "failed" : decision.status };

  if (decision.attempt) {
    const consentAt = new Date();
    const consentEventId = randomUUID();
    await audit("symptom_ai_evaluation", "consent", "success", "symptom_assessment", assessment.id.toString(), { consentEventId });
    try {
      const analyzed = await ai.provider!.evaluateSymptoms(buildSymptomEvaluationInput(assessment));
      const evaluation = await persistSymptomEvaluation({
        assessmentId: assessment.id,
        userId,
        provider: analyzed.provider,
        model: analyzed.model,
        promptVersion: SYMPTOM_EVALUATION_PROMPT_VERSION,
        status: "completed",
        result: { ...analyzed.result, urgencyLevel: assessment.urgencyLevel, redFlagsTriggered: assessment.redFlagsTriggered ?? [] },
        consentAt,
        consentEventId,
      });
      classificationValue = {
        ...classificationValue,
        aiAssessment: buildAiAssessmentSnapshot({
          status: "completed",
          result: analyzed.result as unknown as Record<string, unknown>,
          provider: analyzed.provider,
          model: analyzed.model,
          promptVersion: SYMPTOM_EVALUATION_PROMPT_VERSION,
          redFlags: assessment.redFlagsTriggered ?? [],
          notice: "AI-generated educational context only. It is not a diagnosis or medical advice, and it cannot rule out a serious condition.",
        }),
      };
      await db.update(symptomAssessments).set({ classification: classificationValue, updatedAt: new Date() }).where(eq(symptomAssessments.id, assessment.id));
      await audit("symptom_ai_evaluation", "create", "success", "symptom_ai_evaluation", evaluation.id.toString(), { provider: analyzed.provider, model: analyzed.model, consentEventId });
      outcome.aiStatus = "completed";
      outcome.evaluation = symptomEvaluationView(evaluation);
    } catch (error) {
      const code = error instanceof AIProviderError ? error.code : "provider_unavailable";
      const failedRow = await persistSymptomEvaluation({
        assessmentId: assessment.id,
        userId,
        provider: "unknown",
        model: "unknown",
        promptVersion: SYMPTOM_EVALUATION_PROMPT_VERSION,
        status: "failed",
        errorCode: code,
        consentAt,
        consentEventId,
      });
      classificationValue = {
        ...classificationValue,
        aiAssessment: buildAiAssessmentSnapshot({
          status: "failed",
          errorCode: code,
          redFlags: assessment.redFlagsTriggered ?? [],
          notice: "The AI evaluation failed, so no AI-generated content is shown. The submitted assessment and rule-based guidance were saved unchanged.",
        }),
      };
      await db.update(symptomAssessments).set({ classification: classificationValue, updatedAt: new Date() }).where(eq(symptomAssessments.id, assessment.id));
      await audit("symptom_ai_evaluation", "create", "failure", "symptom_assessment", assessment.id.toString(), { reason: code, consentEventId });
      outcome.aiStatus = "failed";
      outcome.aiErrorCode = code;
      outcome.aiMessage = providerFailureMessages[code] ?? "AI evaluation failed. The assessment was saved unchanged.";
      outcome.evaluation = symptomEvaluationView(failedRow);
    }
  }

  await audit("symptom_assessment", "create", "success", "symptom_assessment", assessment.id.toString(), { urgency: guidance.urgencyLevel, aiStatus: outcome.aiStatus, redFlagCount: guidance.redFlagsTriggered.length });
  return outcome;
}
