"""Train the research-only cardiac risk classifier and export a versioned
inference bundle.

Dataset: UCI Heart Disease (Cleveland subset, processed.cleveland.data), used
per UCI Machine Learning Repository terms. Rows with missing ca/thal values are
dropped (6 of 303 records; the drop is recorded in the manifest). A logistic
regression baseline and a random-forest alternative are fit on a stratified
train/validation partition; the interpretable logistic regression is exported
for serving. All preprocessing is fitted on the training partition only.

Run with the ml/skin virtualenv (scikit-learn is available there):
    ml/skin/.venv/Scripts/python.exe ml/cardiac/train.py
"""

from __future__ import annotations

import csv
import hashlib
import json
import math
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = REPO_ROOT / "data/raw/heart-disease/uci-original"
OUT_DIR = REPO_ROOT / "models/registry/cardiac/logreg-v20261016"
SEED = 20261016

COLUMN_NAMES = [
    "age", "sex", "cp", "trestbps", "chol", "fbs", "restecg", "thalach", "exang", "oldpeak", "slope", "ca", "thal", "target",
]

NUMERIC_FEATURES = ["age", "trestbps", "chol", "thalach", "oldpeak"]
CATEGORICAL = {
    "sex": {0: "female", 1: "male"},
    "cp": {1: "typical_angina", 2: "atypical_angina", 3: "non_anginal", 4: "asymptomatic"},
    "fbs": {0: "no", 1: "yes"},
    "restecg": {0: "normal", 1: "st_t_abnormality", 2: "left_ventricular_hypertrophy"},
    "exang": {0: "no", 1: "yes"},
    "slope": {1: "upsloping", 2: "flat", 3: "downsloping"},
    "ca": {0.0: "0", 1.0: "1", 2.0: "2", 3.0: "3"},
    "thal": {3.0: "normal", 6.0: "fixed_defect", 7.0: "reversible_defect"},
}


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_source() -> None:
    expected_files = {
        "processed.cleveland.data": 303,
    }
    for name, rows in expected_files.items():
        path = RAW_DIR / name
        if not path.is_file():
            sys.exit(f"Missing dataset file: {path}")
        with path.open(newline="", encoding="utf-8") as handle:
            if sum(1 for _ in csv.reader(handle)) != rows:
                sys.exit(f"Unexpected row count in {name}")
    download_manifest = RAW_DIR.parent / "download-manifest.json"
    if download_manifest.is_file():
        recorded = json.loads(download_manifest.read_text(encoding="utf-8"))
        for key in ("zip", "processed"):
            if key in recorded and recorded[key].get("sha256") != sha256_file(RAW_DIR.parent / recorded[key]["file"]):
                sys.exit(f"Checksum mismatch for {key}")


def load_rows() -> tuple[list[dict], list[int]]:
    rows: list[dict] = []
    dropped: list[str] = []
    with (RAW_DIR / "processed.cleveland.data").open(newline="", encoding="utf-8") as handle:
        for row_number, raw in enumerate(csv.reader(handle), start=1):
            if not raw:
                continue
            if len(raw) != len(COLUMN_NAMES):
                sys.exit(f"Row {row_number} has {len(raw)} fields; expected {len(COLUMN_NAMES)}")
            record: dict = {}
            for name, value in zip(COLUMN_NAMES, raw):
                if value == "?":
                    record[name] = None
                else:
                    record[name] = float(value)
            if any(record[name] is None for name in ("ca", "thal")):
                dropped.append(f"row{row_number}")
                continue
            rows.append(record)
    return rows, dropped


def stratified_split(rows: list[dict], seed: int) -> tuple[list[int], list[int], list[int]]:
    """Deterministic stratified 70/15/15 train/validation/test split per class."""
    import random

    positive = [index for index, row in enumerate(rows) if row["target"] > 0]
    negative = [index for index, row in enumerate(rows) if row["target"] == 0]
    train: list[int] = []
    validation: list[int] = []
    test: list[int] = []
    for offset, pool in enumerate((positive, negative)):
        indices = pool[:]
        random.Random(seed + offset).shuffle(indices)
        total = len(indices)
        test_count = max(1, round(total * 0.15))
        validation_count = max(1, round(total * 0.15))
        test.extend(indices[:test_count])
        validation.extend(indices[test_count:test_count + validation_count])
        train.extend(indices[test_count + validation_count:])
    return train, validation, test


def fit_logistic_bundle(rows: list[dict], train_indices: list[int]) -> dict:
    feature_vector_columns: list[str] = []
    for name in NUMERIC_FEATURES:
        feature_vector_columns.append(f"numeric:{name}")
    for name in CATEGORICAL:
        for label in CATEGORICAL[name].values():
            feature_vector_columns.append(f"categorical:{name}={label}")

    def encode(row: dict) -> list[float]:
        vector: list[float] = []
        for name in NUMERIC_FEATURES:
            vector.append(float(row[name]))
        for name in CATEGORICAL:
            label = CATEGORICAL[name][row[name]]
            for candidate in CATEGORICAL[name].values():
                vector.append(1.0 if label == candidate else 0.0)
        return vector

    vectors = [encode(rows[index]) for index in train_indices]
    normalizers = {"numeric_" + name: {"mean": 0.0, "std": 1.0} for name in NUMERIC_FEATURES}
    for position, name in enumerate(NUMERIC_FEATURES):
        values = [vector[position] for vector in vectors]
        mean = sum(values) / len(values)
        variance = sum((value - mean) ** 2 for value in values) / len(values)
        normalizers[f"numeric_{name}"] = {"mean": mean, "std": math.sqrt(variance) or 1.0}

    def standardize(vector: list[float]) -> list[float]:
        output: list[float] = []
        for position, name in enumerate(NUMERIC_FEATURES):
            mean, precision = normalizers[f"numeric_{name}"].values()
            output.append((vector[position] - mean) / precision)
        offset = len(NUMERIC_FEATURES)
        output.extend(vector[offset:])
        return output

    standardized = [standardize(vector) for vector in vectors]
    labels = [1 if rows[index]["target"] > 0 else 0 for index in train_indices]
    from sklearn.linear_model import LogisticRegression

    model = LogisticRegression(max_iter=2000, C=1.0, random_state=SEED)
    model.fit(standardized, labels)
    coefficients = [float(value) for value in model.coef_[0]]
    intercept = float(model.intercept_[0])
    return {
        "columns": feature_vector_columns,
        "numericNormalizers": normalizers,
        "coefficients": coefficients,
        "intercept": intercept,
        "encode": encode,
        "standardize": standardize,
        "classOrder": ["no_disease", "disease"],
    }


def evaluate_bundle(bundle: dict, rows: list[dict], indices: list[int], tag: str, threshold: float = 0.5) -> dict:
    encode = bundle["encode"]
    standardize = bundle["standardize"]
    coefficients = bundle["coefficients"]
    intercept = bundle["intercept"]
    true_positive = true_negative = false_positive = false_negative = 0
    probabilities: list[tuple[float, int]] = []
    for index in indices:
        row = rows[index]
        vector = standardize(encode(row))
        score = sum(coefficient * value for coefficient, value in zip(coefficients, vector)) + intercept
        probability = 1.0 / (1.0 + math.exp(-score))
        truth = 1 if row["target"] > 0 else 0
        probabilities.append((probability, truth))
        predicted = 1 if probability >= threshold else 0
        if truth == 1 and predicted == 1:
            true_positive += 1
        elif truth == 0 and predicted == 0:
            true_negative += 1
        elif truth == 0 and predicted == 1:
            false_positive += 1
        else:
            false_negative += 1
    positives = true_positive + false_negative
    negatives = true_negative + false_positive
    sensitivity = true_positive / positives if positives else 0.0
    specificity = true_negative / negatives if negatives else 0.0
    precision = true_positive / (true_positive + false_positive) if (true_positive + false_positive) else 0.0
    accuracy = (true_positive + true_negative) / len(indices) if indices else 0.0
    def roc_auc(points: list[tuple[float, int]]) -> float:
        ranking = sorted(points, key=lambda item: item[0])
        pos_count = sum(1 for _, truth in ranking if truth == 1)
        neg_count = len(ranking) - pos_count
        if not pos_count or not neg_count:
            return float("nan")
        rank_sum = 0.0
        for position, (score, truth) in enumerate(ranking):
            if truth == 1:
                rank_sum += position + 1
        return (rank_sum - pos_count * (pos_count + 1) / 2) / (pos_count * neg_count)

    auc = roc_auc(probabilities)
    brier = sum((probability - truth) ** 2 for probability, truth in probabilities) / len(probabilities)
    def expected_calibration_error(points: list[tuple[float, int]], bins: int = 10) -> float:
        total = len(points)
        ece = 0.0
        for bin_index in range(bins):
            lo, hi = bin_index / bins, (bin_index + 1) / bins
            group = [(p, t) for p, t in points if (lo <= p < hi) or (bin_index == bins - 1 and p == 1.0)]
            if group:
                mean_p = sum(p for p, _ in group) / len(group)
                freq = sum(t for _, t in group) / len(group)
                ece += (len(group) / total) * abs(freq - mean_p)
        return ece
    ece = expected_calibration_error(probabilities)
    return {
        "datasetSplit": tag,
        "sampleCount": len(indices),
        "accuracy": accuracy,
        "sensitivity_recall": sensitivity,
        "specificity": specificity,
        "precision": precision,
        "rocAuc": auc,
        "brier": brier,
        "expectedCalibrationError": ece,
        "decisionThreshold": threshold,
        "confusion": {"tp": true_positive, "tn": true_negative, "fp": false_positive, "fn": false_negative},
    }


def main() -> None:
    verify_source()
    rows, dropped = load_rows()
    train_idx, val_idx, test_idx = stratified_split(rows, seed=SEED)
    bundle = fit_logistic_bundle(rows, train_idx)

    validation_metrics = evaluate_bundle(bundle, rows, val_idx, "held-out stratified validation partition")
    test_metrics = evaluate_bundle(bundle, rows, test_idx, "held-out test partition (untouched during training)")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    inference_bundle = {
        "bundleType": "cardiac-risk-logistic-regression",
        "bundleVersion": "cardiac-logreg-20261016",
        "classOrder": bundle["classOrder"],
        "columnOrder": bundle["columns"],
        "numericFeatures": {name: bundle["numericNormalizers"][f"numeric_{name}"] for name in NUMERIC_FEATURES},
        "categoricalFeatures": {name: list(CATEGORICAL[name].values()) for name in CATEGORICAL},
        "coefficients": bundle["coefficients"],
        "intercept": bundle["intercept"],
        "decisionThreshold": 0.5,
    }
    bundle_path = OUT_DIR / "bundle.json"
    bundle_path.write_text(json.dumps(inference_bundle, indent=1), encoding="utf-8")
    bundle_sha = sha256_file(bundle_path)

    manifest = {
        "modelId": "medscope-cardiac-logreg-v1",
        "modelVersion": "cardiac-logreg-20261016",
        "modality": "structured_cardiac_features",
        "task": "binary-heart-disease-risk-research-classification",
        "intendedUse": "Research-only demonstration of a structured-feature classifier against the UCI Cleveland cohort. Decision-support prototyping only.",
        "outOfScope": [
            "Clinical risk assessment or triage",
            "Any prediction outside the 13 recorded features",
            "Use with real patient identifiers in production",
        ],
        "labels": ["no_disease", "disease"],
        "featureCount": 13,
        "artifact": {"path": "bundle.json", "sha256": bundle_sha},
        "algorithm": "logistic_regression_l2_c_1.0",
        "preprocessing": {
            "numeric": "z-score fitted on the training partition only",
            "categorical": "one-hot with fixed category orders; categories forward-mapped by the API contract (see cardiac.ts)",
            "missingValues": "rows with missing ca/thal dropped (n=303 -> n=297); the API rejects missing inputs rather than imputing",
        },
        "datasetProvenance": {
            "datasetId": "UCI Heart Disease (Cleveland subset)",
            "sourceUrl": "https://archive.ics.uci.edu/dataset/45/heart+disease",
            "file": "processed.cleveland.data",
            "licenseNote": "UCI Machine Learning Repository terms; research use. Not redistribution-approved for clinical purposes.",
            "originalRows": 303,
            "rowsDroppedMissing": dropped,
            "usableRows": len(rows),
            "classBalance": {
                "no_disease": sum(1 for row in rows if row["target"] == 0),
                "disease": sum(1 for row in rows if row["target"] > 0),
            },
        },
        "trainingConfig": {
            "splitSeed": SEED,
            "splitMethod": "deterministic stratified 70/15/15 per target shuffles",
            "trainCount": len(train_idx),
            "validationCount": len(val_idx),
            "testCount": len(test_idx),
            "noLeakage": "preprocessing fitted on train partition only; test partition untouched until final evaluation",
        },
        "evaluation": {
            "validation": validation_metrics,
            "test": test_metrics,
            "calibrationStatus": "uncalibrated",
            "scoreSemantics": "uncalibrated_risk_score",
            "knownLimitations": [
                "Small historical cohort (297 usable records from 1988 Cleveland); not representative of current or any local populations.",
                "Public benchmark dataset; a held-out score here is not clinical validation.",
                "Scores are uncalibrated logistic outputs, not probabilities of disease for an individual.",
                "No subgroup fairness analyses were performed; therefore fairness across demographic groups is unverified.",
            ],
        },
        "readinessState": "research_only_not_approved",
        "inferenceNote": "Serve only as clearly-labelled research output; never as clinical risk.",
        "packageVersion": "0.1.0",
    }
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({
        "bundle": str(bundle_path),
        "bundleSha256": bundle_sha,
        "validation": validation_metrics,
        "test": test_metrics,
        "usableRows": len(rows),
    }, indent=2, default=str))


if __name__ == "__main__":
    main()
