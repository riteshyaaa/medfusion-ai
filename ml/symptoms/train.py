"""Train the transparent symptom classifier (Bernoulli Naive Bayes) and export
a versioned inference bundle.

Dataset: community "Disease Symptom Prediction" research dataset (verified
against data/raw/symptom-disease/download-manifest.json, sha256-checked). The
classifier is a statistical baseline on self-reported symptoms; the manifest
marks it research-only and the scores are uncalibrated posteriors.

Run with the ml/skin virtualenv (numpy is available there):
    ml/skin/.venv/Scripts/python.exe ml/symptoms/train.py
"""

from __future__ import annotations

import csv
import hashlib
import json
import math
import random
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = REPO_ROOT / "data/raw/symptom-disease"
OUT_DIR = REPO_ROOT / "models/registry/symptoms/bernoulli-nb-v20261016"
ALPHA = 1.0
VAL_FRACTION = 0.2
SEED = 20261016


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_downloads() -> dict:
    manifest_path = RAW_DIR / "download-manifest.json"
    if not manifest_path.is_file():
        sys.exit(f"Missing download manifest: {manifest_path}")
    download_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for key in ("training", "testing"):
        recorded = download_manifest[key]["sha256"]
        actual = sha256_file(RAW_DIR / download_manifest[key]["file"])
        if actual != recorded:
            sys.exit(f"Dataset checksum mismatch for {key}: expected {recorded}, found {actual}")
    return download_manifest


def load_csv(path: Path, expected_features: list[str] | None = None) -> tuple[list[str], list[list[int]], list[str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.reader(handle))
    header = rows[0]
    label_index = len(header) - 1
    if header[label_index] != "prognosis":
        sys.exit(f"Unexpected label column in {path}: {header[label_index]!r}")
    features = list(header[:label_index])
    if expected_features is not None and features != expected_features:
        sys.exit("Feature column order mismatch between Training.csv and Testing.csv")
    samples: list[list[int]] = []
    labels: list[str] = []
    for row in rows[1:]:
        if len(row) != len(header):
            sys.exit("Ragged CSV row; refusing to continue.")
        sample = [int(value) for value in row[:label_index]]
        if any(value not in (0, 1) for value in sample):
            sys.exit("Non-binary feature value found; refusing to continue.")
        samples.append(sample)
        labels.append(row[label_index])
    return features, samples, labels


def stratified_split(labels: list[str], fraction: float, seed: int) -> tuple[list[int], list[int]]:
    by_class: dict[str, list[int]] = {}
    for index, label in enumerate(labels):
        by_class.setdefault(label, []).append(index)
    rng = random.Random(seed)
    validation: list[int] = []
    training: list[int] = []
    for label in sorted(by_class):
        pool = by_class[label][:]
        rng.shuffle(pool)
        cut = max(1, round(len(pool) * fraction))
        validation.extend(pool[:cut])
        training.extend(pool[cut:])
    return sorted(training), sorted(validation)


def fit_bernoulli(samples: list[list[int]], labels: list[str]) -> dict:
    classes = sorted(set(labels))
    feature_count = len(samples[0])
    class_counts = {cls: 0 for cls in classes}
    feature_counts = {cls: [0] * feature_count for cls in classes}
    for sample, label in zip(samples, labels):
        class_counts[label] += 1
        row = feature_counts[label]
        for index, value in enumerate(sample):
            row[index] += value
    total = sum(class_counts.values())
    class_log_prior = {cls: math.log(class_counts[cls] / total) for cls in classes}
    present_log_prob = {
        cls: [math.log((count + ALPHA) / (class_counts[cls] + 2 * ALPHA)) for count in feature_counts[cls]]
        for cls in classes
    }
    absent_log_prob = {
        cls: [math.log((class_counts[cls] - count + ALPHA) / (class_counts[cls] + 2 * ALPHA)) for count in feature_counts[cls]]
        for cls in classes
    }
    return {
        "classes": classes,
        "classLogPrior": class_log_prior,
        "presentLogProb": present_log_prob,
        "absentLogProb": absent_log_prob,
    }


def evaluate(model: dict, samples: list[list[int]], labels: list[str], tag: str) -> dict:
    class_list = model["classes"]
    priors = [model["classLogPrior"][cls] for cls in class_list]
    present = [model["presentLogProb"][cls] for cls in class_list]
    absent = [model["absentLogProb"][cls] for cls in class_list]
    feature_count = len(samples[0])
    hits = top3 = 0
    true_positives = {cls: 0 for cls in class_list}
    predicted_count = {cls: 0 for cls in class_list}
    support = {cls: 0 for cls in class_list}
    for sample, truth in zip(samples, labels):
        scores = []
        for i in range(len(class_list)):
            row_present, row_absent = present[i], absent[i]
            total = priors[i]
            for index in range(feature_count):
                total += row_present[index] if sample[index] == 1 else row_absent[index]
            scores.append(total)
        peak = max(scores)
        exps = [math.exp(value - peak) for value in scores]
        normalizer = sum(exps)
        posterior = [value / normalizer for value in exps]
        order = sorted(range(len(class_list)), key=lambda i: posterior[i], reverse=True)
        predicted = class_list[order[0]]
        predicted_count[predicted] += 1
        support[truth] += 1
        if predicted == truth:
            hits += 1
            true_positives[predicted] += 1
        if truth in {class_list[i] for i in order[:3]}:
            top3 += 1
    macro_f1 = 0.0
    for cls in class_list:
        precision = true_positives[cls] / predicted_count[cls] if predicted_count[cls] else 0.0
        recall = true_positives[cls] / support[cls] if support[cls] else 0.0
        f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
        macro_f1 += f1
    macro_f1 /= max(len(class_list), 1)
    return {
        "datasetSplit": tag,
        "sampleCount": len(labels),
        "accuracy": hits / len(labels),
        "top3Accuracy": top3 / len(labels),
        "macroF1": macro_f1,
    }


def main() -> None:
    download_manifest = verify_downloads()
    features, training_samples, training_labels = load_csv(RAW_DIR / "Training.csv")
    _t_features, test_samples, test_labels = load_csv(RAW_DIR / "Testing.csv", expected_features=features)
    train_idx, val_idx = stratified_split(training_labels, VAL_FRACTION, SEED)
    train_samples = [training_samples[i] for i in train_idx]
    train_split_labels = [training_labels[i] for i in train_idx]
    val_samples = [training_samples[i] for i in val_idx]
    val_labels = [training_labels[i] for i in val_idx]

    model = fit_bernoulli(train_samples, train_split_labels)
    validation_metrics = evaluate(model, val_samples, val_labels, "held-out stratified validation partition (Training.csv)")
    testing_metrics = evaluate(model, test_samples, test_labels, "provided Testing.csv (1 sample per class)")

    class_sample_counts = {cls: sum(1 for label in training_labels if label == cls) for cls in model["classes"]}

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    bundle = {
        "bundleType": "symptom-classifier-bernoulli-nb",
        "bundleVersion": "symptom-bernoulli-nb-20261016",
        "alpha": ALPHA,
        "features": features,
        "classes": model["classes"],
        "classLogPrior": model["classLogPrior"],
        "presentLogProb": model["presentLogProb"],
        "absentLogProb": model["absentLogProb"],
    }
    bundle_path = OUT_DIR / "bundle.json"
    bundle_path.write_text(json.dumps(bundle, indent=1), encoding="utf-8")
    bundle_sha = sha256_file(bundle_path)

    manifest = {
        "modelId": "medscope-symptoms-bernoulli-nb-v1",
        "modelVersion": "symptom-bernoulli-nb-20261016",
        "modality": "structured_symptoms",
        "task": "symptom-to-condition-research-classification",
        "intendedUse": "Research-only ranked possible conditions from self-reported binary symptoms. Decision-support prototyping only.",
        "outOfScope": [
            "Diagnosis or treatment selection",
            "Urgent-care triage (the separate transparent rule engine owns urgency)",
            "Any use with patient identifiers in production",
        ],
        "classes": model["classes"],
        "classCount": len(model["classes"]),
        "featureCount": len(features),
        "artifact": {"path": "bundle.json", "sha256": bundle_sha},
        "framework": {"name": "python+json-export", "inferenceDependency": "none", "alpha": ALPHA},
        "datasetProvenance": {
            "datasetId": download_manifest["datasetId"],
            "sourceOrigin": download_manifest["sourceOrigin"],
            "sourceUrl": download_manifest["sourceUrl"],
            "licenseNote": download_manifest["licenseNote"],
            "training": {key: download_manifest["training"][key] for key in ("file", "sha256")},
            "testing": {key: download_manifest["testing"][key] for key in ("file", "sha256")},
            "classDistribution": "120 training samples per class (uniform)",
        },
        "trainingConfig": {
            "algorithm": "bernoulli_naive_bayes_laplace_alpha_1",
            "validationFraction": VAL_FRACTION,
            "splitSeed": SEED,
            "splitMethod": "stratified-by-class-shuffle",
            "featuresFittedOn": "training partition only",
        },
        "evaluation": {
            "classSampleCounts": class_sample_counts,
            "heldOutValidation": validation_metrics,
            "providedTestingCsv": testing_metrics,
            "calibrationStatus": "not_calibrated",
            "scoreSemantics": "uncalibrated_posterior",
            "knownLimitations": [
                "Self-reported binary symptoms from a single-source research dataset.",
                "Uniform class distribution does not match real-world disease prevalence; posteriors are not prevalence-adjusted probabilities.",
                "Naive independence assumption overstates certainty when symptoms co-occur.",
                "Conditions outside the 41-class vocabulary cannot be detected; unselected symptoms are scored as absent.",
            ],
        },
        "readinessState": "research_only_not_approved",
        "inferenceNote": "Serve only as clearly-labelled research output alongside, never instead of, the urgency rules.",
        "packageVersion": "0.1.0",
    }
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({
        "bundle": str(bundle_path),
        "bundleSha256": bundle_sha,
        "validation": validation_metrics,
        "testing": testing_metrics,
        "classes": len(model["classes"]),
        "features": len(features),
    }, indent=2))


if __name__ == "__main__":
    main()
