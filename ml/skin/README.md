# Skin model research pipeline

This package trains and evaluates one image-only PAD-UFES-20 research baseline. It is not connected to API inference, and its outputs are not approved for user-facing predictions. The application reports `model_unavailable` until a separate promotion and inference phase is completed.

## Local Windows setup

Python 3.10–3.14 is supported. The CPU environment is sufficient; a CUDA device is optional and not required. From the repository root in PowerShell:

```powershell
py -3.14 -m venv ml/skin/.venv
ml/skin/.venv/Scripts/python.exe -m pip install -r ml/skin/requirements-cpu.txt
ml/skin/.venv/Scripts/python.exe -m pip install --no-deps -e ml/skin
ml/skin/.venv/Scripts/python.exe -m unittest discover -s ml/skin/tests -v
```

`requirements-cpu.lock.txt` records the resolved environment used for this baseline run. Dataset downloads and model training are separate commands; ordinary JavaScript install, typecheck, and build commands do not fetch medical images or model weights.

## Dataset rights and download

The selected source is [PAD-UFES-20 v1](https://doi.org/10.17632/zr7vgbcyr2.1), distributed under CC BY 4.0. Review the source and attribution terms in [`../../docs/research/datasets.md`](../../docs/research/datasets.md) before downloading. The downloader requires an explicit `--accept-license` flag, records the archive SHA-256 and retrieval time, refuses to overwrite files, and stores the archive under ignored `data/raw/`. The data and patient-linked metadata are not committed or sent to third parties.

```powershell
ml/skin/.venv/Scripts/python.exe -m medscope_skin download --accept-license
ml/skin/.venv/Scripts/python.exe -m medscope_skin extract
ml/skin/.venv/Scripts/python.exe -m medscope_skin validate
```

Extraction checks ZIP paths, links, and total uncompressed size. Validation checks the CSV and image references, class mapping, image decoding, identifiers, exact duplicate hashes, and aggregate counts. It prints counts only; it does not print patient identifiers.

## Train and inspect a run

```powershell
ml/skin/.venv/Scripts/python.exe -m medscope_skin train --run-id pad-ufes-baseline-v1
ml/skin/.venv/Scripts/python.exe -m medscope_skin verify-manifest outputs/ml/skin/pad-ufes-baseline-v1/manifest.json
```

The versioned configuration is [`configs/pad_ufes_v1_baseline.json`](configs/pad_ufes_v1_baseline.json). It specifies a randomly initialized compact CNN, deterministic RGB resize/crop and normalization, training-only horizontal flip, inverse-frequency class-weighted loss, early stopping on validation loss, and a patient/lesion/exact-image-hash grouped train/validation/test split. When byte-identical images have conflicting source labels, every row in that hash group is excluded and counted; same-label duplicates are retained but kept within one split. A scratch CNN keeps the baseline small enough for the available CPU and avoids fetching third-party model weights; it is an initial benchmark, not a claim that this architecture is optimal. The source archive hash is checked against its download manifest before training. The held-out test set is evaluated once after model selection.

Each ignored `outputs/ml/skin/<run-id>/` directory contains the checkpoint, an image-ID split manifest for local reproduction, the aggregate test report, a reliability plot, a run summary, and a model manifest with the checkpoint checksum. Training and `verify-manifest` both reload the checkpoint with safe tensor loading, check architecture and class order, and run a finite-output shape smoke test. Do not publish the split manifest because source image IDs may be linkable to patient records.

The report's softmax values are **uncalibrated raw model scores**, not individual disease probabilities. Calibration statistics are diagnostics only; no calibration transform is fitted. Threshold coverage is likewise exploratory and is not used by the application. Every generated manifest is marked `research_only_not_approved`; `--require-approved` must fail until a separate evidence-based promotion process exists.

## Reproducibility and limitations

- Training seed, CPU/GPU selection, dependency versions, image preprocessing, class order, dataset archive hash, split hash, evaluation report, and model artifact checksum are recorded.
- Splits group patients and lesions together and merge exact byte duplicates before assignment. The split builder rejects any split missing a configured class or crossing patient, lesion, or image-hash groups.
- Reports include per-class precision/recall/F1/support, macro-F1, confusion matrix, top-2 accuracy, NLL, multiclass Brier score, top-label ECE, a reliability plot, raw-score threshold coverage, and supported subgroup summaries.
- The dataset is a regional Brazilian smartphone-photo cohort with substantial class imbalance and mixed biopsy/dermatologist-consensus reference labels. A same-dataset holdout is not external validation and does not establish clinical usefulness or performance on MedScope users.
- This pipeline does not produce a clinically validated, regulatory-cleared, or production-ready diagnostic model. Do not use its output to make or rule out a diagnosis or treatment decision.
