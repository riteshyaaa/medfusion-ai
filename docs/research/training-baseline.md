# PAD-UFES-20 v1 skin image baseline

**Run date:** 2026-10-15  
**Status:** Completed research run; artifact verified; **not approved for application inference**.  
**Purpose:** Establish a reproducible, image-only training and held-out evaluation path. These results are not clinical validation or evidence of performance on MedScope users.

## Provenance and data handling

The source is PAD-UFES-20 v1, [DOI 10.17632/zr7vgbcyr2.1](https://doi.org/10.17632/zr7vgbcyr2.1), with the dataset record's CC BY 4.0 terms. Attribution and permitted-use notes are in [`datasets.md`](datasets.md). The local 3,593,344,681-byte archive has SHA-256 `e8c7e17bac1698c97e44d4096ec20ac1b91c135285c1446b7b2e7ebbc9be933c` and remains in ignored `data/raw/`; neither the archive nor extracted images are committed.

Validation matched all 2,298 metadata rows to PNG images and reproduced the source class counts. Exact-byte analysis found 15 duplicate-hash groups. Twelve groups (24 image rows) had conflicting labels; all samples in those groups were excluded from model development. The remaining three same-label groups were retained and kept together by the split code. The eligible set has 2,274 images: ACK 724, BCC 834, MEL 52, NEV 243, SCC 186, and SEK 235. The archive itself was not modified.

## Training and split

- **Task:** six-class image-only classification of PAD-UFES-20 smartphone clinical lesion photographs. Bowen's disease (BOD) is mapped to SCC as described by the dataset authors.
- **Architecture:** `medscope-small-cnn-v1`, randomly initialized compact CNN; no pretrained weights.
- **Preprocessing:** RGB, 160×160 center fit with Lanczos resampling, ImageNet mean/std normalization, and seeded horizontal flip during training only (`pad-ufes-rgb-160-center-fit-v1`).
- **Optimization:** inverse-frequency class-weighted cross-entropy, AdamW, learning rate 0.0008, batch size 32, at most 12 epochs, early stopping on validation loss with patience 3.
- **Reproducibility:** seed `20261015`; CPU run with PyTorch `2.14.1+cpu`, Python `3.14.7`, eight configured CPU threads. Best checkpoint was epoch 4; training stopped after epoch 7.
- **Split:** patient-, lesion-, and exact-image-hash-grouped stratification. Train 1,459, validation 362, held-out test 453. The test partition contains 274 patients. Split manifest SHA-256: `e5a85a604aad24b88f389b5b05164d226e6685e1e9e0b24b1692f282c6d49f85`.

## Held-out test results

The test set is 453 images from the same PAD-UFES-20 v1 source. It was not used for early stopping or model selection. Values are computed from this run's held-out outputs and rounded to three decimals for display.

| Metric | Result |
| --- | ---: |
| Accuracy | 0.245 |
| Macro-F1 | 0.229 |
| Top-2 accuracy | 0.506 |
| Negative log-likelihood | 1.743 |
| Multiclass Brier score | 0.816 |
| Top-label ECE, 10 bins | 0.099 |

| Class | Precision | Sensitivity/recall | One-vs-rest specificity | F1 | Test support |
| --- | ---: | ---: | ---: | ---: | ---: |
| ACK | 0.333 | 0.159 | 0.851 | 0.215 | 145 |
| BCC | 0.633 | 0.187 | 0.937 | 0.288 | 166 |
| MEL | 0.093 | 0.500 | 0.889 | 0.156 | 10 |
| NEV | 0.265 | 0.563 | 0.815 | 0.360 | 48 |
| SCC | 0.109 | 0.162 | 0.882 | 0.130 | 37 |
| SEK | 0.153 | 0.404 | 0.741 | 0.222 | 47 |

Confusion matrix (rows are true classes, columns are predicted classes; order: ACK, BCC, MEL, NEV, SCC, SEK):

|  | ACK | BCC | MEL | NEV | SCC | SEK |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ACK | 23 | 12 | 13 | 34 | 10 | 53 |
| BCC | 30 | 31 | 9 | 23 | 37 | 36 |
| MEL | 3 | 0 | 5 | 0 | 0 | 2 |
| NEV | 3 | 0 | 12 | 27 | 1 | 5 |
| SCC | 8 | 5 | 4 | 5 | 6 | 9 |
| SEK | 2 | 1 | 11 | 13 | 1 | 19 |

## Score meaning and subgroup summaries

The checkpoint emits **raw, uncalibrated model scores**. No calibration transform was fitted. NLL, Brier score, ECE, and the local reliability plot are diagnostics; they do not make these scores individual disease probabilities. The report's raw-score threshold coverage is exploratory: at threshold 0.5, coverage was 0.075 and accuracy among accepted cases was 0.118. No threshold or candidate list is enabled in the application.

The test set contains limited metadata. Descriptive groups meeting the configured minimum support of 30 were:

| Field/value | n | Accuracy | Macro-F1 over classes present |
| --- | ---: | ---: | ---: |
| Fitzpatrick 2.0 | 172 | 0.186 | 0.146 |
| Fitzpatrick 3.0 | 91 | 0.143 | 0.112 |
| Sex FEMALE | 150 | 0.153 | 0.142 |
| Sex MALE | 147 | 0.231 | 0.205 |
| Age 62 | 33 | 0.242 | 0.225 |

These groups are imbalanced and often lack test examples for some classes; they are not reliable fairness estimates. The source paper does not establish broad or population-representative skin-tone coverage, and no external evaluation was performed.

## Artifact and limitations

- Local run directory: ignored `outputs/ml/skin/pad-ufes20-v1-cnn-baseline-20261015/`.
- Model manifest: `manifest.json`; aggregate report: `evaluation_report.json`; reliability plot: `reliability.png`; local split manifest: `split_manifest.json`.
- Artifact SHA-256: `2b7b8036e104adca0db1ee7390f647bfc5f29026f1837170487e0f46c78390ea`.
- Manifest verification checked task, ordered labels, preprocessing version, readiness state, and checksum. A CPU checkpoint smoke test loaded the state with safe tensor loading and returned a finite `(1, 6)` output. `--require-approved` correctly rejects this artifact.
- The model is marked `research_only_not_approved`. It is not loaded by the API and must not be used for diagnosis, treatment, or ruling out disease. The low held-out macro-F1, class imbalance, only 10 melanoma test samples, mixed label reference standards, single-source evaluation, and limited subgroup support do not justify user-facing use.
- No clinical validation, external validation, prospective study, or regulatory assessment has been performed. These benchmark metrics are not a claim of clinical accuracy or patient benefit.
