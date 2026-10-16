# Research register

**Reviewed:** 2026-10-15. This register contains primary dataset papers and official dataset records reviewed for the first Skin Analysis modality. The summaries describe each source's own dataset or experiment and are not evidence of clinical benefit or validation for MedScope AI.

## HAM10000 dataset descriptor

- **Citation:** Philipp Tschandl, Cliff Rosendahl, and Harald Kittler. “The HAM10000 dataset, a large collection of multi-source dermatoscopic images of common pigmented skin lesions.” *Scientific Data* 5, 180161 (2018). [DOI 10.1038/sdata.2018.161](https://doi.org/10.1038/sdata.2018.161).
- **Type/status:** peer-reviewed data descriptor; published 2018-08-14.
- **Question it informs:** what images, labels, source populations, and reference standards make up the original HAM10000 release?
- **Dataset/methods:** 10,015 dermatoscopic images from two source settings (Vienna tertiary referral/high-risk follow-up and Queensland primary care). Seven pigmented-lesion classes; 53.3% pathologic verification in the paper's summary table, with other labels from follow-up, expert consensus, or confocal microscopy.
- **Main use here:** provenance, class counts, label definitions, and source limitations only. No accuracy result from this dataset descriptor is treated as a MedScope performance claim.
- **Limitations/generalizability:** highly imbalanced classes; source cohorts are not population-representative; non-pigmented and several body-site lesion types are excluded; multiple images can belong to a lesion; public metadata does not provide a patient-level split key; no usable Fitzpatrick distribution is reported. The dataset has a separate CC BY-NC 4.0 license even though the article itself is CC BY 4.0.
- **Project decision:** keep as a screened non-selected candidate. Avoid training here because the dataset license is non-commercial and the acquisition modality is dermatoscopy.
- **Verification:** article body, original class-count table, Harvard Dataverse v4.0 record, and current ISIC collection record reviewed 2026-10-15. [Harvard Dataverse](https://doi.org/10.7910/DVN/DBW86T), [ISIC Archive collection](https://api.isic-archive.com/collections/212/).

## PAD-UFES-20 data descriptor

- **Citation:** Andre G. C. Pacheco et al. “PAD-UFES-20: A skin lesion dataset composed of patient data and clinical images collected from smartphones.” *Data in Brief* 32, 106221 (2020). [DOI 10.1016/j.dib.2020.106221](https://doi.org/10.1016/j.dib.2020.106221).
- **Type/status:** peer-reviewed data descriptor; dataset record version 1 published 2020-07-07.
- **Question it informs:** can a licensed smartphone clinical-image dataset support a first image-only skin-lesion baseline with leakage-resistant patient splits?
- **Dataset/methods:** 2,298 images, 1,641 lesions, and 1,373 patients, with six diagnosis labels and clinical metadata. All BCC, SCC, and melanoma cases are biopsy-proven; benign diagnoses were made by dermatologist consensus. The paper reports 58.4% biopsy-proven lesions overall and gives per-label counts.
- **Main use here:** select PAD-UFES-20 v1 for a six-class image-only research baseline. Patient and lesion identifiers support patient-level splitting; structured fields will be held out of this unimodal experiment.
- **Limitations/generalizability:** the source is a particular Brazilian assistance program across 11 Espírito Santo municipalities. The paper describes most participants as descendants of European immigrants and farm workers with substantial sun exposure, with average age around 60. Melanoma has only 52 images; classes are strongly imbalanced. Smartphone make and image dimensions vary. The paper does not establish a complete Fitzpatrick subgroup distribution or broad external validity.
- **Project decision:** use for an educational/research baseline under the dataset's explicit CC BY 4.0 license. Do not claim representative coverage, clinical validation, or performance on users.
- **Verification:** original paper body and Mendeley/DataCite v1 dataset rights metadata reviewed 2026-10-15. [Mendeley Data record](https://doi.org/10.17632/zr7vgbcyr2.1), [DataCite rights metadata](https://api.datacite.org/dois/10.17632/zr7vgbcyr2.1), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Derm7pt multimodal dataset and model paper

- **Citation:** Jeremy Kawahara, Sara Daneshvar, Giuseppe Argenziano, and Ghassan Hamarneh. “7-Point Checklist and Skin Lesion Classification using Multi-Task Multi-Modal Neural Nets.” *IEEE Journal of Biomedical and Health Informatics*. [DOI 10.1109/JBHI.2018.2824327](https://doi.org/10.1109/JBHI.2018.2824327).
- **Type/status:** peer-reviewed research article; published online 2018. The official SFU site links the article and the dataset.
- **Question it informs:** what tasks and inputs were studied in the published Derm7pt work?
- **Dataset/methods:** the article reports 1,011 cases and uses clinical and dermoscopic images plus metadata to predict a skin-condition diagnosis and seven-point checklist criteria. It describes a multi-task, multimodal convolutional network. This is the authors' experimental setup, not a MedScope design proof.
- **Main use here:** document the dataset's task and modality and screen its reuse terms. Do not adopt the paper's scores as a target or clinical-performance claim.
- **Limitations/generalizability:** the diagnosis and checklist labels are imbalanced; image data include multiple modalities per case. Public terms require a password request and specify CC BY-NC-ND 4.0. The dataset's no-derivatives restriction makes training use unresolved; the public page reviewed here does not establish a patient-level split key or skin-tone subgroup counts.
- **Project decision:** do not download or train on Derm7pt without written permission clarifying data access and derivative-model rights.
- **Verification:** paper PDF linked from the official SFU publication page and the official [download/terms page](https://derm.cs.sfu.ca/Download.html) reviewed 2026-10-15.
