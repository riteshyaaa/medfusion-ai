from __future__ import annotations

from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from sklearn.metrics import confusion_matrix, precision_recall_fscore_support


def _calibration_metrics(labels: np.ndarray, probabilities: np.ndarray, bins: int = 10) -> dict[str, Any]:
    sample_count = len(labels)
    one_hot = np.eye(probabilities.shape[1], dtype=np.float64)[labels]
    clipped = np.clip(probabilities.astype(np.float64), 1e-12, 1.0)
    loss = float(-np.log(clipped[np.arange(sample_count), labels]).mean())
    brier = float(np.square(probabilities - one_hot).sum(axis=1).mean())
    predicted = probabilities.argmax(axis=1)
    confidence = probabilities.max(axis=1)
    correct = predicted == labels
    bin_rows = []
    ece = 0.0
    for bin_index in range(bins):
        lower = bin_index / bins
        upper = (bin_index + 1) / bins
        in_bin = (confidence >= lower) & ((confidence < upper) if bin_index < bins - 1 else (confidence <= upper))
        count = int(in_bin.sum())
        if count == 0:
            bin_rows.append({"lower": lower, "upper": upper, "count": 0, "meanConfidence": None, "accuracy": None})
            continue
        mean_confidence = float(confidence[in_bin].mean())
        accuracy = float(correct[in_bin].mean())
        ece += count / sample_count * abs(mean_confidence - accuracy)
        bin_rows.append({"lower": lower, "upper": upper, "count": count, "meanConfidence": mean_confidence, "accuracy": accuracy})
    return {"negativeLogLikelihood": loss, "multiclassBrierScore": brier, "expectedCalibrationErrorTopLabel10Bins": float(ece), "reliabilityBins": bin_rows}


def compute_metrics(labels: np.ndarray, probabilities: np.ndarray, label_order: list[str], abstention_thresholds: list[float]) -> dict[str, Any]:
    predictions = probabilities.argmax(axis=1)
    precision, recall, f1, support = precision_recall_fscore_support(
        labels,
        predictions,
        labels=list(range(len(label_order))),
        zero_division=0,
    )
    per_class = {
        label: {
            "precision": float(precision[index]),
            "recall": float(recall[index]),
            "sensitivity": float(recall[index]),
            "f1": float(f1[index]),
            "support": int(support[index]),
        }
        for index, label in enumerate(label_order)
    }
    matrix = confusion_matrix(labels, predictions, labels=list(range(len(label_order))))
    total = int(matrix.sum())
    for class_index, label in enumerate(label_order):
        true_positive = int(matrix[class_index, class_index])
        false_negative = int(matrix[class_index, :].sum()) - true_positive
        false_positive = int(matrix[:, class_index].sum()) - true_positive
        true_negative = total - true_positive - false_negative - false_positive
        specificity_denominator = true_negative + false_positive
        per_class[label]["specificity"] = float(true_negative / specificity_denominator) if specificity_denominator else None
    top_k = min(2, len(label_order))
    top_k_predictions = np.argpartition(probabilities, -top_k, axis=1)[:, -top_k:]
    calibration = _calibration_metrics(labels, probabilities)
    abstention = []
    max_score = probabilities.max(axis=1)
    for threshold in abstention_thresholds:
        accepted = max_score >= threshold
        count = int(accepted.sum())
        abstention.append({
            "rawScoreThreshold": float(threshold),
            "acceptedCount": count,
            "coverage": float(count / len(labels)),
            "accuracyAmongAccepted": float((predictions[accepted] == labels[accepted]).mean()) if count else None,
        })
    return {
        "sampleCount": int(len(labels)),
        "accuracy": float((predictions == labels).mean()),
        "macroF1": float(np.mean(f1)),
        "top2Accuracy": float(np.any(top_k_predictions == labels[:, None], axis=1).mean()),
        "classOrder": label_order,
        "perClass": per_class,
        "confusionMatrix": matrix.tolist(),
        "scoreSemantics": "raw_model_score",
        "probabilityInterpretation": "Uncalibrated softmax outputs used only for evaluation diagnostics; not an individual's disease probability.",
        "calibration": calibration,
        "abstentionCoverage": abstention,
    }


def compute_subgroup_metrics(labels: np.ndarray, probabilities: np.ndarray, subgroups: list[dict[str, str]], label_order: list[str], minimum_support: int) -> dict[str, Any]:
    predictions = probabilities.argmax(axis=1)
    output: dict[str, Any] = {}
    fields = sorted({field for row in subgroups for field in row})
    for field in fields:
        groups = sorted({row[field] for row in subgroups if field in row})
        field_metrics: dict[str, Any] = {}
        for value in groups:
            indices = np.asarray([index for index, row in enumerate(subgroups) if row.get(field) == value], dtype=np.int64)
            if len(indices) < minimum_support:
                continue
            _, _, f1, support = precision_recall_fscore_support(
                labels[indices],
                predictions[indices],
                labels=list(range(len(label_order))),
                zero_division=0,
            )
            present = support > 0
            field_metrics[value] = {
                "sampleCount": int(len(indices)),
                "accuracy": float((predictions[indices] == labels[indices]).mean()),
                "macroF1OverPresentClasses": float(f1[present].mean()) if present.any() else None,
                "supportByClass": {label: int(support[i]) for i, label in enumerate(label_order)},
            }
        output[field] = {
            "minimumSupport": minimum_support,
            "reportedGroups": field_metrics,
            "omittedSmallGroups": True,
        }
    return output


def write_reliability_plot(labels: np.ndarray, probabilities: np.ndarray, destination: Path) -> None:
    predicted = probabilities.argmax(axis=1)
    confidence = probabilities.max(axis=1)
    accuracy = (predicted == labels).astype(np.float64)
    edges = np.linspace(0.0, 1.0, 11)
    mean_confidence: list[float] = []
    observed_accuracy: list[float] = []
    for index in range(len(edges) - 1):
        in_bin = (confidence >= edges[index]) & ((confidence < edges[index + 1]) if index < len(edges) - 2 else (confidence <= edges[index + 1]))
        if in_bin.any():
            mean_confidence.append(float(confidence[in_bin].mean()))
            observed_accuracy.append(float(accuracy[in_bin].mean()))

    figure, axis = plt.subplots(figsize=(6, 6))
    axis.plot([0, 1], [0, 1], linestyle="--", color="gray", label="ideal reference")
    axis.plot(mean_confidence, observed_accuracy, marker="o", color="#275dad", label="held-out test")
    axis.set(xlim=(0, 1), ylim=(0, 1), xlabel="Mean raw softmax score", ylabel="Observed top-label accuracy", title="Calibration diagnostic only")
    axis.legend(loc="lower right")
    figure.text(0.5, 0.01, "Scores are uncalibrated and are not patient-specific probabilities.", ha="center", fontsize=8)
    figure.tight_layout(rect=(0, 0.04, 1, 1))
    destination.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(destination, dpi=150)
    plt.close(figure)
