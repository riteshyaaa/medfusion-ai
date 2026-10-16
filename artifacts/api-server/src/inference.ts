export type PredictionOutput = {
  disease: string;
  confidence: number;
  description: string;
  severity: string;
  recommendations: string[];
  differentialDiagnoses: Array<{ disease: string; confidence: number }>;
  preprocessingSteps: string[];
  modelId: string;
  modelVersion: string;
  preprocessingVersion: string;
  scoreSemantics: "raw_model_score" | "calibrated_probability";
};

export interface InferenceProvider {
  readonly simulated?: boolean;
  predict(image: Buffer): Promise<PredictionOutput>;
}

let testProvider: InferenceProvider | undefined;

export function setTestInferenceProvider(provider: InferenceProvider | undefined): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("A test inference provider can only be installed in test mode");
  }
  testProvider = provider;
}

export function getTestInferenceProvider(): InferenceProvider | undefined {
  return process.env.NODE_ENV === "test" ? testProvider : undefined;
}

// No production inference provider is currently promoted. Phase 4 must replace
// this fail-closed state with manifest, checksum, task, and readiness validation.
export function hasApprovedSkinModel(): boolean {
  return false;
}
