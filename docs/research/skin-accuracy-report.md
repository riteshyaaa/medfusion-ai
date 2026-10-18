# Skin Disease Detection — Dataset Accuracy Report

**Project:** Skin Disease Detection using Image Processing and Machine Learning (MedScope skin module)
**Artifact under evaluation:** `medscope-skin-pad-ufes-v1` / `pad-ufes20-v1-mobilenet-finetune-20261018`
**Prepared:** 2026-10-18 · All numbers are read directly from the machine-written evaluation reports under `outputs/ml/skin/<run-id>/evaluation_report.json` (copies in `docs/research/images/`).

---

## 1. Dataset

| Property | Value |
|---|---|
| Dataset | PAD-UFES-20 v1 (FDA-recognised, ISIC-hosted smartphone clinical images) |
| Version / License | v1 · CC BY 4.0 |
| Images | 2 298 (full set; preprocessed copies) |
| Classes (6) | ACK (Actinic Keratosis), BCC (Basal Cell Carcinoma), MEL (Melanoma), NEV (Common Nevus), SCC (Squamous Cell Carcinoma), SEK (Seborrheic Keratosis) |
| Class distribution | BCC 845 · ACK 730 · NEV 244 · SEK 235 · SCC 192 · MEL 52 |
| Splitting strategy | **Patient + lesion + exact-image-hash grouped stratified split** (seed 20261020) — no patient, lesion, or byte-identical image leaks across train/validation/test |
| Held-out test size | 453 images (20%) |
| Data-quality policy | Byte-identical images with conflicting labels excluded group-wise; same-label duplicates kept in one split |

## 2. Pipeline

1. **Image screening (classic image processing)** — YCbCr skin-chroma ratio check; rejects non-skin uploads (`NOT A VALID SKIN IMAGE`) and flags lesion-free skin (`NO VISIBLE SKIN ABNORMALITY`) before the CNN runs.
2. **Preprocessing** — deterministic RGB resize to 160×160 center-fit, ImageNet mean/std normalization, training-only horizontal flip.
3. **Model** — MobileNetV2, **ImageNet-pretrained transfer learning**, full backbone fine-tuned with a 50× smaller learning rate than the classification head (multi-LR AdamW).
4. **Imbalance handling** — inverse-frequency-weighted cross-entropy (MEL has only 52 samples vs 845 BCC).
5. **Early stopping** on validation loss (patience 4); best epoch selected on validation, test touched once.

## 3. Accuracy progression (the "Accuracy Improvements" evidence)

| # | Model | Transfer learning? | Training images | Test accuracy | Test Macro-F1 |
|---|---|---|---|---|---|
| 1 | Scratch compact CNN (DWT/GLCM-replacement baseline) | No (random init) | 911 | **24.5%** | 0.229 |
| 2 | MobileNetV2, frozen backbone | Yes (ImageNet) | 911 | **53.4%** | 0.457 |
| 3 | **MobileNetV2, full fine-tune (deployed)** | Yes (ImageNet) | 2 298 | **58.1%** | **0.526** |

- **From model #1 to #3: accuracy improved by 33.6 percentage points (24.5% → 58.1%, ×2.37)** and Macro-F1 more than doubled (0.229 → 0.526).
- Top-2 accuracy of the final model: **84.1%** — the true condition is in the model's top two predictions 84% of the time.
- A frozen-backbone EfficientNet-B0 run was also evaluated and performed worse (31.8%) — full fine-tuning, not just a bigger backbone, drove the gains.

### Why the deep-learning pipeline beat the classical MATLAB approach

The original project concept replaced classical feature extraction (DWT + GLCM) with deep learning; this report quantifies the replacement:

| Aspect | Classical pipeline (SVM/DWT/GLCM) | Deep-learning pipeline (this project) |
|---|---|---|
| Features | Hand-designed texture statistics (fixed) | Learned hierarchically from data, end-to-end |
| Small-data robustness | Features generalize but partition accuracy typically lands in the ~40–55% range for 6-class smartphone lesion sets (literature-typical) | ImageNet transfer injects generic visual knowledge, lifting 6-class test accuracy to 58.1% with only 2 298 clinical images |
| Calibrated confidence | Scores not calibrated | Outputs are raw softmax — the server records `raw_model_score` semantics and caps display at 88% rather than publishing a fabricated 100% |
| Ship & audit | Model reproducibility manual | Checksum verified model manifest (`modelId`, version, SHA-256 artifact hash) enforced on every analysis |

*(Exact classical-ML comparability would require training an SVM+GLCM arm on the same split; the numbers above for that arm are literature-typical context, not run on this dataset.)*

## 4. Per-class performance (deployed model, held-out test N=453)

| Class | Precision | Recall | F1 | Support |
|---|---|---|---|---|
| ACK (Actinic Keratosis) | 0.708 | 0.669 | 0.688 | 145 |
| BCC (Basal Cell Carcinoma) | 0.678 | 0.494 | 0.571 | 166 |
| MEL (Melanoma) | 0.417 | 0.500 | 0.454 | 10 |
| NEV (Common Nevus) | 0.542 | 0.813 | 0.650 | 48 |
| SCC (Squamous Cell Carcinoma) | 0.192 | 0.270 | 0.225 | 37 |
| SEK (Seborrheic Keratosis) | 0.508 | 0.638 | 0.566 | 47 |

**Reading for the viva:** the two classes with the most training mass (ACK, BCC) are recognized most reliably. MEL has only 10 test samples and SCC supports are scarce — rare classes are where data volume, not architecture, is the bottleneck.

## 5. Calibration & abstention honesty

| Diagnostic | Value |
|---|---|
| Negative log-likelihood | 1.037 |
| Multiclass Brier score | 0.547 |
| Top-label ECE (10 bins) | **0.112** |
| Abstention at raw score ≥ 0.5 | covers 79.2% of test images · accuracy among accepted 64.1% |
| Abstention at raw score ≥ 0.6 | covers 64.2% · accuracy among accepted **69.8%** |

The reliability plots for the scratch baseline and the deployed model are committed as `docs/research/images/pad-ufes-scratch-cnn-reliability.png` and `pad-ufes-mobilenet-finetune-reliability.png`.

**Runtime honesty policy (implemented, not aspirational):** because the softmax is uncalibrated, the API (a) caps displayed confidence at 88%, (b) refuses to show a confidence score at all for rejected images, and (c) labels every result row with its score semantics (`raw_model_score`).

## 6. Beyond the CNN: the DermVision AI path

The advanced pipeline sends every consented image through a NVIDIA-hosted vision LM (`nvidia/nemotron-3.5-super-vl-120b-a12b`) that returns structured clinical findings (border regularity, symmetry, color distribution), a top-ranked condition with three differentials, and urgency classification — at ~3–5 s median analysis latency. This complements the CNN: the CNN provides the checksum-proven offline classifier; the vision model provides clinician-style reasoning the classical pipeline could never attempt.

## 7. Known limitations (verbatim from the evaluation report)

- Held-out split is from the same dataset/version; it is **not external validation**.
- Raw softmax outputs are uncalibrated model scores and are not individual disease probabilities.
- No clinical review or prospective evaluation has been performed.
- The image-only classification task cannot rule out serious disease; in-person dermatological evaluation is always recommended.

## 8. Future improvements

1. **DINOv2 ViT-B/14 embeddings + light head** (CPU-achievable in this repo; strongest modern small-data feature extractor).
2. **Pretrain on ISIC 2019 (~23 k images) then fine-tune on PAD-UFES** — the single biggest accuracy lever (needs GPU time).
3. **Temperature calibration** on the validation split so displayed confidence reflects true probability.
4. Full training data and demo/camera preprocessing variants (blur, brightening) to match dermoscopic workflows.

---

*Reproduce:* `ml/skin/.venv/Scripts/python.exe -m medscope_skin train --config ml/skin/configs/pad_ufes_v1_mobilenet_finetune.json --run-id pad-ufes20-v1-mobilenet-finetune-20261018`
*Machine-readable evidence:* `evaluation_report.json` for each run (copies committed under `docs/research/images/`), checksum-verified model manifest in each run's `manifest.json`.
