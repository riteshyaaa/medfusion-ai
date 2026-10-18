from __future__ import annotations

import json
import random
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import torch
from sklearn.metrics import f1_score
from torch import nn
from torch.utils.data import DataLoader, Dataset
from PIL import Image

from . import __version__
from .dataset import Sample, load_samples
from .download import verify_download_manifest
from .evaluation import compute_metrics, compute_subgroup_metrics, write_reliability_plot
from .manifest import sha256_file, verify_manifest
from .model import SUPPORTED_ARCHITECTURES, create_skin_model
from .splits import DatasetSplit, make_splits, write_split_manifest
from .transforms import ImageTransform


class _ImageDataset(Dataset[tuple[torch.Tensor, int]]):
    def __init__(self, samples: list[Sample], indices: tuple[int, ...], label_order: list[str], transform: ImageTransform) -> None:
        self.samples = samples
        self.indices = indices
        self.label_indices = {label: index for index, label in enumerate(label_order)}
        self.transform = transform

    def __len__(self) -> int:
        return len(self.indices)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, int]:
        sample = self.samples[self.indices[index]]
        with Image.open(sample.image_path) as source:
            return self.transform(source), self.label_indices[sample.label]


def _seed_everything(seed: int, cpu_threads: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.set_num_threads(cpu_threads)
    torch.use_deterministic_algorithms(True)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
        torch.backends.cudnn.deterministic = True
        torch.backends.cudnn.benchmark = False


def _batch_logits(model: nn.Module, loader: DataLoader, device: torch.device, loss_function: nn.Module | None = None) -> tuple[np.ndarray, np.ndarray, float | None]:
    model.eval()
    labels: list[np.ndarray] = []
    probabilities: list[np.ndarray] = []
    total_loss = 0.0
    total_samples = 0
    with torch.inference_mode():
        for images, targets in loader:
            images = images.to(device)
            targets = targets.to(device)
            logits = model(images)
            if loss_function:
                batch_loss = loss_function(logits, targets)
                total_loss += float(batch_loss.item()) * len(targets)
            labels.append(targets.cpu().numpy())
            probabilities.append(torch.softmax(logits, dim=1).cpu().numpy())
            total_samples += len(targets)
    all_labels = np.concatenate(labels)
    all_probabilities = np.concatenate(probabilities)
    average_loss = total_loss / total_samples if loss_function and total_samples else None
    return all_labels, all_probabilities, average_loss


def _train_epoch(model: nn.Module, loader: DataLoader, optimizer: torch.optim.Optimizer, loss_function: nn.Module, device: torch.device) -> float:
    model.train()
    total_loss = 0.0
    total_samples = 0
    for images, targets in loader:
        images = images.to(device)
        targets = targets.to(device)
        optimizer.zero_grad(set_to_none=True)
        loss = loss_function(model(images), targets)
        loss.backward()
        optimizer.step()
        total_loss += float(loss.item()) * len(targets)
        total_samples += len(targets)
    return total_loss / max(total_samples, 1)


def _load_source_manifest(path: Path) -> dict[str, Any]:
    return verify_download_manifest(path)


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    with path.open("x", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")


def _count_patients(samples: list[Sample], indices: tuple[int, ...]) -> int:
    return len({samples[index].patient_id for index in indices})


def smoke_test_checkpoint(path: Path, label_order: list[str], image_size: int) -> dict[str, Any]:
    checkpoint = torch.load(path, map_location="cpu", weights_only=True)
    if not isinstance(checkpoint, dict):
        raise ValueError("Model checkpoint must contain a tensor-state dictionary.")
    architecture_id = checkpoint.get("architecture")
    if architecture_id not in SUPPORTED_ARCHITECTURES or checkpoint.get("labelOrder") != label_order:
        raise ValueError("Model checkpoint architecture or label order is incompatible.")
    state = checkpoint.get("state_dict")
    if not isinstance(state, dict):
        raise ValueError("Model checkpoint is missing its state dictionary.")
    model = create_skin_model(architecture_id, len(label_order), pretrained=False)
    model.load_state_dict(state, strict=True)
    model.eval()
    with torch.inference_mode():
        output = model(torch.zeros((1, 3, image_size, image_size), dtype=torch.float32))
    if tuple(output.shape) != (1, len(label_order)) or not bool(torch.isfinite(output).all()):
        raise ValueError("Model checkpoint smoke inference returned an invalid tensor.")
    return {"status": "smoke_test_passed", "outputShape": list(output.shape), "finiteScores": True}


def run_training(data_root: Path, config: dict[str, Any], source_manifest: dict[str, Any], output_dir: Path, split_manifest_path: Path | None = None) -> dict[str, Any]:
    if output_dir.exists():
        raise FileExistsError(f"Refusing to overwrite an existing training output: {output_dir}")
    model_config = config["model"]
    architecture_id = model_config.get("architecture")
    if architecture_id not in SUPPORTED_ARCHITECTURES:
        raise ValueError(f"This training package only supports the configured architectures: {', '.join(SUPPORTED_ARCHITECTURES)}.")
    if architecture_id == "medscope-small-cnn-v1" and (model_config.get("initialization") != "random" or model_config.get("pretrained_weights") is not False):
        raise ValueError("SmallSkinCNN runs must stay randomly initialized.")
    if architecture_id == "medscope-mobilenetv2-v1" and model_config.get("pretrained_weights") != "imagenet":
        raise ValueError("MobileNetV2 runs transfer ImageNet pretrained weights (model.pretrained_weights = \"imagenet\").")
    freeze_backbone = bool(model_config.get("freeze_backbone", False))
    transferBackbones = ("medscope-mobilenetv2-v1", "medscope-efficientnet-v1")
    if freeze_backbone and architecture_id not in transferBackbones:
        raise ValueError("Only the transfer architectures support freezing the backbone.")
    output_dir.mkdir(parents=True, exist_ok=False)

    seed = int(config["split"]["seed"])
    _seed_everything(seed, int(config["training"]["cpu_threads"]))
    samples, dataset_summary = load_samples(data_root, config)
    label_order = list(config["task"]["labels"])
    split: DatasetSplit = make_splits(
        samples,
        label_order,
        seed,
        float(config["split"]["test_fraction"]),
        float(config["split"]["validation_fraction_of_remaining"]),
    )
    split_path = split_manifest_path or output_dir / "split_manifest.json"
    write_split_manifest(split_path, samples, split, config["dataset"]["id"], config["dataset"]["version"], seed)

    preprocessing = config["preprocessing"]
    train_transform = ImageTransform(preprocessing["image_size"], preprocessing["mean"], preprocessing["std"], training=True, horizontal_flip=preprocessing["train_horizontal_flip"])
    evaluation_transform = ImageTransform(preprocessing["image_size"], preprocessing["mean"], preprocessing["std"])
    training_data = _ImageDataset(samples, split.train, label_order, train_transform)
    validation_data = _ImageDataset(samples, split.validation, label_order, evaluation_transform)
    test_data = _ImageDataset(samples, split.test, label_order, evaluation_transform)

    generator = torch.Generator().manual_seed(seed)
    common_loader_options = {"batch_size": int(config["training"]["batch_size"]), "num_workers": int(config["training"]["num_workers"]), "pin_memory": False}
    training_loader = DataLoader(training_data, shuffle=True, generator=generator, **common_loader_options)
    validation_loader = DataLoader(validation_data, shuffle=False, **common_loader_options)
    test_loader = DataLoader(test_data, shuffle=False, **common_loader_options)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = create_skin_model(architecture_id, len(label_order), pretrained=architecture_id in ("medscope-mobilenetv2-v1", "medscope-efficientnet-v1")).to(device)
    freeze_backbone = bool(model_config.get("freeze_backbone", False))
    head_lr = float(config["training"]["learning_rate"])
    if architecture_id in ("medscope-mobilenetv2-v1", "medscope-efficientnet-v1"):
        backbone_params = {id(parameter) for parameter in model.features.parameters()}
        if freeze_backbone:
            for parameter in model.features.parameters():
                parameter.requires_grad = False
        head_params = [parameter for parameter in model.parameters() if id(parameter) not in backbone_params and parameter.requires_grad]
        trainable_backbone = [parameter for parameter in model.features.parameters() if parameter.requires_grad]
        optimizer = torch.optim.AdamW(
            [
                {"params": head_params, "lr": head_lr},
                {"params": trainable_backbone, "lr": head_lr * float(model_config.get("backbone_lr_multiplier", 0.1))},
            ],
            weight_decay=float(config["training"]["weight_decay"]),
        )
    else:
        optimizer = torch.optim.AdamW((parameter for parameter in model.parameters() if parameter.requires_grad), lr=head_lr, weight_decay=float(config["training"]["weight_decay"]))
    counts = np.asarray([sum(samples[index].label == label for index in split.train) for label in label_order], dtype=np.float32)
    if np.any(counts == 0):
        raise ValueError("At least one class has no samples in the training split.")
    class_weights = counts.sum() / (len(label_order) * counts)
    loss_function = nn.CrossEntropyLoss(weight=torch.tensor(class_weights, dtype=torch.float32, device=device))

    best_validation_loss = float("inf")
    best_epoch = 0
    best_state: dict[str, torch.Tensor] | None = None
    stale_epochs = 0
    history: list[dict[str, float | int]] = []
    start_time = time.perf_counter()
    epoch_limit = int(config["training"]["epochs"])
    patience = int(config["training"]["early_stopping_patience"])

    for epoch in range(1, epoch_limit + 1):
        train_loss = _train_epoch(model, training_loader, optimizer, loss_function, device)
        validation_labels, validation_probabilities, validation_loss = _batch_logits(model, validation_loader, device, loss_function)
        if validation_loss is None:
            raise RuntimeError("Validation loss was not computed.")
        validation_macro_f1 = float(f1_score(validation_labels, validation_probabilities.argmax(axis=1), labels=list(range(len(label_order))), average="macro", zero_division=0))
        history.append({"epoch": epoch, "trainingLoss": train_loss, "validationLoss": validation_loss, "validationMacroF1": validation_macro_f1})
        print(json.dumps({"event": "epoch_complete", **history[-1]}))
        if validation_loss < best_validation_loss:
            best_validation_loss = validation_loss
            best_epoch = epoch
            best_state = {name: tensor.detach().cpu().clone() for name, tensor in model.state_dict().items()}
            stale_epochs = 0
        else:
            stale_epochs += 1
            if stale_epochs >= patience:
                break

    if best_state is None:
        raise RuntimeError("Training produced no checkpoint.")
    model.load_state_dict(best_state)
    model.to(device)
    checkpoint_path = output_dir / "model.pt"
    torch.save({"state_dict": best_state, "architecture": architecture_id, "labelOrder": label_order}, checkpoint_path)

    test_labels, test_probabilities, _ = _batch_logits(model, test_loader, device)
    test_metrics = compute_metrics(test_labels, test_probabilities, label_order, list(config["evaluation"]["abstention_score_thresholds"]))
    test_subgroups = [samples[index].subgroups for index in split.test]
    test_metrics["subgroups"] = compute_subgroup_metrics(
        test_labels,
        test_probabilities,
        test_subgroups,
        label_order,
        int(config["evaluation"]["subgroup_minimum_support"]),
    )
    test_metrics["datasetIdentity"] = {"datasetId": config["dataset"]["id"], "version": config["dataset"]["version"], "doi": config["dataset"]["doi"]}
    test_metrics["split"] = {
        "strategy": "patient-lesion-and-exact-image-hash-grouped-stratification",
        "seed": seed,
        "splitManifestSha256": split.manifest_sha256,
        "sampleCount": len(split.test),
        "patientGroupCount": _count_patients(samples, split.test),
        "trainingSampleCount": len(split.train),
        "validationSampleCount": len(split.validation),
    }
    test_metrics["evaluationCaveats"] = [
        "Held-out split is from the same dataset/version; it is not external validation.",
        "Raw softmax outputs are uncalibrated model scores and are not individual disease probabilities.",
        "Subgroup summaries are descriptive and are omitted below the configured support threshold.",
        "No clinical review or prospective evaluation has been performed.",
    ]
    report_path = output_dir / "evaluation_report.json"
    _write_json(report_path, test_metrics)
    write_reliability_plot(test_labels, test_probabilities, output_dir / "reliability.png")

    model_manifest: dict[str, Any] = {
        "modelId": "medscope-skin-pad-ufes-v1",
        "modelVersion": output_dir.name,
        "modality": "image",
        "task": config["task"]["id"],
        "intendedUse": "Research-only six-class classification of smartphone clinical skin-lesion images from PAD-UFES-20 v1.",
        "outOfScope": ["Diagnosis of other conditions", "Dermatoscopic or histopathology inputs", "Ruling out serious disease", "Treatment recommendations", "Clinical use without independent validation"],
        "labels": label_order,
        "artifact": {"path": checkpoint_path.name, "sha256": sha256_file(checkpoint_path)},
        "framework": {"name": "PyTorch", "version": torch.__version__, "pythonVersion": __import__("platform").python_version()},
        "preprocessingVersion": preprocessing["version"],
        "datasetProvenance": {
            "datasetId": config["dataset"]["id"],
            "version": config["dataset"]["version"],
            "doi": config["dataset"]["doi"],
            "sourceUrl": config["dataset"]["source_url"],
            "license": config["dataset"]["license"],
            "archiveSha256": source_manifest["archiveSha256"],
            "downloadedAtUtc": source_manifest["downloadedAtUtc"],
        },
        "trainingConfig": config,
        "trainingHistory": history,
        "bestEpoch": best_epoch,
        "elapsedSeconds": round(time.perf_counter() - start_time, 3),
        "evaluationReport": report_path.name,
        "testSetIdentity": {"datasetId": config["dataset"]["id"], "version": config["dataset"]["version"], "splitManifestSha256": split.manifest_sha256, "sampleCount": len(split.test)},
        "scoreSemantics": "raw_model_score",
        "calibrationStatus": "not_calibrated",
        "calibrationDiagnostics": "Raw-softmax NLL, multiclass Brier score, top-label ECE, and reliability plot; no calibration transform is applied.",
        "readinessState": "research_only_not_approved",
        "packageVersion": __version__,
    }
    model_manifest_path = output_dir / "manifest.json"
    _write_json(model_manifest_path, model_manifest)
    verify_manifest(model_manifest_path, config["task"]["id"], label_order, preprocessing["version"], require_approved=False)
    checkpoint_smoke_test = smoke_test_checkpoint(checkpoint_path, label_order, int(preprocessing["image_size"]))

    run_summary = {
        "status": "completed_research_run",
        "runId": output_dir.name,
        "device": str(device),
        "datasetSummary": dataset_summary,
        "splitCounts": {"train": len(split.train), "validation": len(split.validation), "test": len(split.test)},
        "bestEpoch": best_epoch,
        "macroF1": test_metrics["macroF1"],
        "modelReadiness": model_manifest["readinessState"],
        "scoreSemantics": model_manifest["scoreSemantics"],
        "checkpointSmokeTest": checkpoint_smoke_test,
        "evaluationReport": str(report_path),
        "manifest": str(model_manifest_path),
    }
    _write_json(output_dir / "run_summary.json", run_summary)
    return run_summary
