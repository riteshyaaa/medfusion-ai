# Skin image dataset provenance and rights review

**Reviewed:** 2026-10-15  
**Scope:** first image-only skin-lesion classification experiment. After verifying the source record and terms below, PAD-UFES-20 v1 was downloaded locally on 2026-10-15. No dataset images or patient-linked metadata have been added to Git.

The dataset owner/host's terms were checked before any download. Paper licenses and dataset licenses are recorded separately. “Publicly accessible” does not by itself establish permission to train or redistribute. This register records the terms visible at the linked sources; it is not legal advice.

## Candidate summary

| Dataset/release | Modality and labels | Version and verified size | Access and rights | Decision |
| --- | --- | --- | --- | --- |
| [PAD-UFES-20 v1](https://data.mendeley.com/datasets/zr7vgbcyr2/1) | Smartphone clinical lesion images; six diagnosis classes | Mendeley v1, published 2020-07-07; 2,298 images, 1,641 lesions, 1,373 patients | Public Mendeley record and direct 3.35 GB download link. Dataset DOI metadata identifies CC BY 4.0. No login requirement is stated on the page; access was not exercised. | **Selected for the first baseline**, subject to the downloaded files matching the documented version and schema. |
| [HAM10000, Harvard Dataverse v4.0](https://doi.org/10.7910/DVN/DBW86T) | Dermatoscopic images; seven pigmented-lesion labels | Original release: 10,015 images. Harvard record currently identifies v4.0. The current ISIC collection page separately reports 11,720 images, 8,838 lesions, and 0 specified patients. These counts describe different snapshots and must not be merged. | Public files. The dataset's custom terms and ISIC record specify CC BY-NC 4.0; attribution and non-commercial use are required. | Screened, **not selected**. The non-commercial condition and dermatoscopy-to-phone-photo shift make it a poor default for this product. |
| [Derm7pt](https://derm.cs.sfu.ca/Welcome.html) | Clinical and dermoscopic images; diagnosis plus seven-point checklist labels | Original paper: 1,011 cases. Dataset site shows thumbnails for 2,045 images. | Download requires a password request form. The owner states CC BY-NC-ND 4.0: non-commercial and no derivatives. | **Not selected**. Do not download or train without written rights clarification; training-derived artifacts may raise additional interpretation questions under the no-derivatives term. |

## Selected candidate: PAD-UFES-20

- **Official record and version:** [Mendeley Data, DOI 10.17632/zr7vgbcyr2.1](https://doi.org/10.17632/zr7vgbcyr2.1), Version 1, published 2020-07-07. The record describes a 3.35 GB archive and links the data descriptor. The associated [DataCite record](https://api.datacite.org/dois/10.17632/zr7vgbcyr2.1) lists **CC BY 4.0** for the dataset itself. The [Data in Brief article](https://doi.org/10.1016/j.dib.2020.106221) is also open access, but its article license is not being used as a substitute for the dataset license.
- **Permitted use:** CC BY 4.0 permits copying, adaptation, and commercial or non-commercial reuse with attribution, a license link, and indication of changes. Planned attribution: Pacheco, A. G. C. et al. (2020), *PAD-UFES-20*, version 1, Mendeley Data, [DOI 10.17632/zr7vgbcyr2.1](https://doi.org/10.17632/zr7vgbcyr2.1), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The experiment adapts the image set through deterministic resizing/cropping and a patient-grouped split. The project will not put the raw archive, extracted images, or patient-linked CSV in Git or send them to an external provider.
- **Access:** the Mendeley record is public and presents a direct download link. It does not state a registration requirement; this was not independently tested by downloading. No images have been retrieved yet.
- **Image count and labels:** 2,298 smartphone clinical images from 1,641 lesions and 1,373 patients. The six labels and image counts reported in the paper are:

  | Label | Meaning | Images |
  | --- | --- | ---: |
  | ACK | Actinic keratosis | 730 |
  | BCC | Basal cell carcinoma | 845 |
  | MEL | Melanoma | 52 |
  | NEV | Nevus | 244 |
  | SCC | Squamous cell carcinoma, including Bowen's disease in situ | 192 |
  | SEK | Seborrheic keratosis | 235 |

- **Label source:** the paper reports that all BCC, SCC, and MEL lesions are biopsy-proven. Benign diagnoses (ACK, NEV, SEK) were made by dermatologist consensus. Overall, 58.4% of lesions are biopsy-proven. Thus class labels do not all have the same reference standard.
- **Identifiers and split strategy:** the dataset record/paper documents `patient_id`, `lesion_id`, and image IDs that link images to patients and lesions. A patient can have multiple lesions and a lesion can have multiple images. Splits must group by patient, with a second check for lesion overlap and exact/near-duplicate images. Random image-level splits are prohibited.
- **Demographic representation:** metadata includes age, sex/gender, region, and a Fitzpatrick skin-type field. The paper says data were collected in 11 municipalities in Espírito Santo, Brazil; most participants were descendants of European immigrants and were or had been farm workers with substantial sun exposure; average age was about 60. The published article does not give a complete Fitzpatrick subgroup distribution or robust subgroup-performance estimates. Field availability is not evidence of representative coverage.
- **Limitations and domain shift:** only six labels are included; melanoma has 52 images and is severely underrepresented. Images come from different smartphones and have differing dimensions. The source is a regional assistance program rather than a population-representative sample. Diagnostic labels mix biopsy and dermatologist consensus. This is closer to user-submitted clinical photography than dermoscopy, but still does not establish performance on MedScope users or arbitrary skin images.
- **Redistribution:** the dataset record names CC BY 4.0, so redistribution is allowed with required attribution and license notices. The project will keep images and patient-linked metadata local and ignored by Git; permission to redistribute data does not make redistribution necessary or appropriate.
- **Training decision:** use only the image and diagnosis label for an explicitly six-class research baseline. Do not use the structured clinical metadata, infer a universal disease taxonomy, or expose predictions in the application. Do not call the output an individual's disease probability.
- **Local acquisition and validation record:** downloaded from the public Mendeley v1 endpoint on 2026-10-15. Archive size: 3,593,344,681 bytes. SHA-256: `e8c7e17bac1698c97e44d4096ec20ac1b91c135285c1446b7b2e7ebbc9be933c`. The archive and per-file manifest are under ignored `data/raw/`; the manifest records retrieval time and source. Validation matched all 2,298 metadata rows to PNG files and reproduced the paper's six source counts. Exact-byte analysis found 15 repeated-hash groups; 12 groups (24 rows) had conflicting diagnosis labels. Those 24 rows are excluded from model development under the explicit configured policy; the original downloaded data remain unchanged. The remaining 2,274 images retain all six classes, with source and eligible counts recorded separately.

## Screened candidate: HAM10000

- **Official sources:** the [Harvard Dataverse dataset record](https://doi.org/10.7910/DVN/DBW86T), current [ISIC Archive collection](https://api.isic-archive.com/collections/212/), and [ISIC challenge dataset page](https://challenge.isic-archive.com/data/). The original data descriptor is Tschandl, Rosendahl, and Kittler (2018), [Scientific Data 5, 180161](https://doi.org/10.1038/sdata.2018.161).
- **Version/count distinction:** the original training release contains 10,015 images; the Dataverse record lists metadata for 10,015 observations in v4.0. The current ISIC collection page reports 11,720 image records, 8,838 specified lesions, and no specified patients. Use a versioned source and manifest; do not assume the current archive collection is identical to the original 10,015-image release.
- **License/access:** the dataset-specific Harvard terms and ISIC collection page identify CC BY-NC 4.0. The separate Scientific Data article has its own CC BY 4.0 article license; that does not change the dataset's CC BY-NC terms. Files are listed as public. Attribution is required and commercial use is not permitted under CC BY-NC 4.0. The license permits non-commercial sharing/adaptation subject to its terms.
- **Original class counts:** `akiec` 327, `bcc` 514, `bkl` 1,099, `df` 115, `mel` 1,113, `nv` 6,705, and `vasc` 142 (10,015 total). The paper's table reports 53.3% pathologic verification overall; other ground truth uses follow-up, expert consensus, or reflectance confocal microscopy.
- **Source and limitations:** dermatoscopic lesions were collected over 20 years from a high-risk tertiary referral center in Vienna and a primary-care skin-cancer practice in Queensland, Australia. The paper describes source-specific populations and devices, but does not provide a usable Fitzpatrick distribution. Non-pigmented, ocular, subungual, and mucosal lesions were excluded. This is dermatoscopy, not ordinary phone photography.
- **Identifiers/leakage:** the release documents repeated images per lesion and a `lesion_id`, allowing lesion-level grouping. The current archive reports zero specified patient records, so patient-level partitioning is not supported by the public archive metadata. Deduplication and lesion grouping would be mandatory.
- **Decision:** do not download or train on HAM10000 in this implementation. Its verified non-commercial license is narrower than the selected PAD-UFES-20 license, and its dermatoscopic acquisition differs from the app's image-upload workflow.

## Screened candidate: Derm7pt

- **Official sources:** [dataset overview](https://derm.cs.sfu.ca/Welcome.html), [download and terms](https://derm.cs.sfu.ca/Download.html), and Kawahara et al., [“7-Point Checklist and Skin Lesion Classification using Multi-Task Multi-Modal Neural Nets”](https://doi.org/10.1109/JBHI.2018.2824327), IEEE Journal of Biomedical and Health Informatics.
- **Size/task:** the official download page shows 2,045 image thumbnails; the paper reports 1,011 cases and describes clinical and dermoscopic images plus patient metadata. It includes grouped diagnosis labels and seven-point checklist annotations. The paper's grouped diagnosis counts are BCC 42, NEV 575, MEL 252, miscellaneous 97, and seborrheic keratosis 45; checklist categories are separate labels.
- **Access and license:** the owner requires a password request form to obtain a login. The owner states CC BY-NC-ND 4.0. Attribution is required, commercial use is prohibited, and derivatives are not permitted. This project will not download, extract, or train on it without written permission that resolves the no-derivatives restriction.
- **Metadata/representation/limitations:** the paper describes gender, lesion location, and other metadata, but the public page/paper reviewed here does not establish a patient-level split identifier or a Fitzpatrick/skin-tone distribution. The 1,011 cases have multiple images; diagnosis classes and checklist annotations are imbalanced. The access restriction prevents inspecting the complete release manifest, exact source identifiers, or full metadata distribution.

## Reproducibility rules for the selected data

- Pin the dataset DOI/version, source URLs, download date, archive SHA-256, observed file counts, label mapping, and preprocessing version in every run manifest.
- Keep the original archive and extracted patient-linked files under ignored `data/raw/`; keep derived images and splits under ignored `data/processed/` and `data/splits/`.
- Commit only code, documentation, aggregate evaluation reports, and non-sensitive manifests. Do not commit images, per-patient rows, or patient/lesion identifiers.
- Build train/validation/test assignments by `patient_id`, then verify patient and lesion disjointness and duplicate-image hashes before training.
- A split manifest may contain opaque image IDs locally. Do not publish that manifest if it exposes source identifiers or patient-linked rows.
