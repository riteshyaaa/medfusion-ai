export type SkinClassNature = "benign" | "pre_cancerous" | "malignant";

export interface SkinClassKnowledge {
  readonly code: string;
  readonly displayName: string;
  readonly shortName: string;
  readonly nature: SkinClassNature;
  readonly severity: "mild" | "moderate" | "severe";
  readonly clinicalDescription: (confidencePercent: string) => string;
  readonly recommendations: readonly string[];
}

export const SKIN_LABEL_KNOWLEDGE: readonly SkinClassKnowledge[] = [
  {
    code: "ACK",
    displayName: "Actinic Keratosis (ACK)",
    shortName: "Actinic Keratosis",
    nature: "pre_cancerous",
    severity: "moderate",
    clinicalDescription: (confidencePercent) =>
      `This appears most consistent with actinic keratosis, a rough, scaly, sandpaper-like patch that develops on chronically sun-exposed skin such as the face, scalp, ears, forearms, and hands. Lesions are often easier to feel than to see, may be slightly tender or itchy, and a small proportion can progress to squamous cell carcinoma over time if left untreated. The AI analysis used this pattern to rank actinic keratosis as the leading candidate at ${confidencePercent}% confidence.`,
    recommendations: [
      "Have the lesion examined in person by a dermatologist — images alone cannot reliably separate actinic keratosis from early skin cancer, and a dermatoscope or biopsy is often used to confirm.",
      "Treatment options a dermatologist may offer include cryotherapy (freezing), prescription topical field therapy (such as 5-fluorouracil or imiquimod), or photodynamic therapy, depending on how many lesions there are.",
      "Do not scratch, pick, or scrape the area — this can worsen irritation and make assessment harder.",
      "Start strict sun protection now: broad-spectrum SPF 30+ daily, sun-protective clothing, wide hats, and shade during peak hours, to prevent new lesions from forming.",
      "Re-check the skin every few months; seek care sooner if a spot thickens, bleeds, becomes painful, or grows rapidly.",
    ],
  },
  {
    code: "BCC",
    displayName: "Basal Cell Carcinoma (BCC)",
    shortName: "Basal Cell Carcinoma",
    nature: "malignant",
    severity: "moderate",
    clinicalDescription: (confidencePercent) =>
      `This appears most consistent with basal cell carcinoma, the most common form of skin cancer. It classically presents as a slow-growing pearly or waxy bump, sometimes with fine visible blood vessels on the surface, that may bleed easily, form an open sore that heals and then reopens, or develop a raised, rolled edge. BCC very rarely spreads to other organs but can gradually erode surrounding skin and tissue if left untreated. The AI analysis ranked this pattern highest at ${confidencePercent}% confidence.`,
    recommendations: [
      "Book a dermatology appointment promptly (within the coming weeks) for in-person confirmation — a dermoscopic exam and, if needed, a small biopsy is the standard way to verify the diagnosis.",
      "Treatment options a dermatologist may offer include surgical excision, Mohs micrographic surgery (often preferred on the face or for recurrent lesions), cryotherapy, or photodynamic therapy for superficial types — the choice depends on the size, site, and subtype.",
      "Do not pick, scratch, or attempt to remove the lesion yourself.",
      "Keep the area protected from sun exposure: broad-spectrum SPF 30+ daily, protective clothing, and shade during peak hours.",
      "Regardless of treatment outcome, plan annual full-skin checks, since people who develop one basal cell carcinoma have a higher chance of another.",
    ],
  },
  {
    code: "MEL",
    displayName: "Melanoma (MEL)",
    shortName: "Melanoma",
    nature: "malignant",
    severity: "severe",
    clinicalDescription: (confidencePercent) =>
      `This image shows features the AI associates with melanoma, the most serious form of skin cancer because of its potential to spread. Concerning lesions typically show ABCDE warning signs: Asymmetry, irregular Borders, uneven or mixed Colour, a Diameter larger than about 6 mm, and Evolution — any change in size, shape, colour, or behaviour over weeks to months. The AI analysis ranked melanoma as the leading candidate at ${confidencePercent}% confidence; this pattern warrants prompt attention.`,
    recommendations: [
      "Seek a dermatologist evaluation urgently — within days to a few weeks, not months. Melanoma outcomes depend strongly on how early it is found.",
      "Expect the dermatologist to examine the lesion with a dermatoscope and likely take a biopsy or perform an excision; this is the only way to confirm or exclude the diagnosis.",
      "Do not scrape, shave, cut, or apply anything to the lesion while waiting for the appointment.",
      "Photograph the lesion next to a ruler now, so any change before the appointment can be documented.",
      "Arrange a full-body skin check and review of other moles; first-degree relatives should also be informed so they can watch their own skin.",
    ],
  },
  {
    code: "NEV",
    displayName: "Common Nevus (Mole)",
    shortName: "Common Nevus",
    nature: "benign",
    severity: "mild",
    clinicalDescription: (confidencePercent) =>
      `This appears most consistent with a common nevus (mole) — a small, well-defined, evenly pigmented tan-to-brown lesion composed of benign melanocytes. Benign moles are typically symmetrical with a smooth, regular border and uniform colour, and they remain stable in size and appearance over time. The AI analysis is the most confident about this benign pattern among the candidate conditions, ranking it at ${confidencePercent}% confidence.`,
    recommendations: [
      "No treatment is needed for a stable, typical mole — keep it under observation rather than removing it.",
      "Photograph the mole now (with a coin or ruler for scale) so that any future change in size, shape, or colour can be objectively compared.",
      "Follow the ABCDE rule during periodic self-checks: Asymmetry, irregular Borders, uneven Colour, Diameter over 6 mm, or Evolution — any of these is a reason for a dermatology visit.",
      "Practise sun protection (broad-spectrum SPF 30+, protective clothing, shade) to slow new moles and long-term damage.",
      "If you have many moles, a personal or family history of skin cancer, or freckling plus repeated sunburns, schedule a periodic full-body dermatology review.",
    ],
  },
  {
    code: "SCC",
    displayName: "Squamous Cell Carcinoma (SCC)",
    shortName: "Squamous Cell Carcinoma",
    nature: "malignant",
    severity: "moderate",
    clinicalDescription: (confidencePercent) =>
      `This appears most consistent with squamous cell carcinoma, the second most common skin cancer. It classically presents as a firm, red, scaly or crusted bump or patch that may feel tender, bleed easily, or develop an ulcer or a hard, horn-like surface. SCC grows faster than basal cell carcinoma and has a real, though still modest, potential to spread when left untreated. The AI analysis ranked this pattern highest at ${confidencePercent}% confidence.`,
    recommendations: [
      "Book a dermatology appointment promptly for in-person confirmation — dermoscopy plus a biopsy is the standard assessment path.",
      "Treatment options a dermatologist may offer include surgical excision, Mohs surgery (often used on the face, ears, or for recurrent lesions), cryotherapy, or radiation in selected cases, depending on size and location.",
      "Do not pick at or squeeze the lesion.",
      "Protect the site from the sun and start broad-spectrum SPF 30+ daily use, since UV damage drives this condition.",
      "Ask about checking for sun-damaged skin elsewhere (lip borders, ears, hands, scalp) and schedule regular follow-up skin exams after treatment.",
    ],
  },
  {
    code: "SEK",
    displayName: "Seborrheic Keratosis (SEK)",
    shortName: "Seborrheic Keratosis",
    nature: "benign",
    severity: "mild",
    clinicalDescription: (confidencePercent) =>
      `This appears most consistent with a seborrheic keratosis, one of the most common benign skin growths, especially after middle age. These growths look "stuck on" like a blotter of brown wax, with a pasted-on silhouette, rough warty surface, and often visible plugged follicular openings. They cause no medical harm, though they can itch or catch on clothing. The AI analysis ranked this benign pattern as the leading candidate at ${confidencePercent}% confidence.`,
    recommendations: [
      "No treatment is required — a seborrheic keratosis is harmless and generally left alone.",
      "If it catches on clothing or jewellery, itches, or is cosmetically bothersome, a dermatologist can remove it easily with cryotherapy, curettage, or a brief shave excision.",
      "Avoid scraping or picking it off at home, which can cause bleeding, infection, and prevent accurate future assessment.",
      "Watch for context: a sudden eruption of many dark, greasy-looking growths is uncommon and worth mentioning at a check-up.",
      "Any spot that changes quickly, bleeds spontaneously, or looks different from your other keratoses deserves an in-person look to rule out a look-alike skin cancer.",
    ],
  },
];

export function getSkinLabelKnowledge(code: string): SkinClassKnowledge | undefined {
  return SKIN_LABEL_KNOWLEDGE.find((entry) => entry.code === code);
}
