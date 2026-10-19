import sharp from "sharp";

const MAX_IMAGE_PIXELS = 40_000_000;

export type SkinScreeningVerdict = "not_skin" | "normal_skin" | "lesion_present";
export interface SkinScreening {
  verdict: SkinScreeningVerdict;
  skinRatio: number;
  lesionRatio: number;
}

/** Deterministic local skin screening, mirroring ml/skin infer.screen_image. */
export async function screenSkinImage(source: Buffer): Promise<SkinScreening> {
  const { data, info } = await sharp(source, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error" })
    .rotate()
    .resize(128, 128, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const pixelCount = info.width * info.height;
  const skin: boolean[] = new Array(pixelCount).fill(false);
  const skinPixels: number[][] = [];
  let skinCount = 0;
  for (let i = 0; i < pixelCount; i += 1) {
    const red = data[i * channels];
    const green = data[i * channels + 1];
    const blue = data[i * channels + 2];
    const luma = 0.299 * red + 0.587 * green + 0.114 * blue;
    const cb = 128.0 - 0.168736 * red - 0.331264 * green + 0.5 * blue;
    const cr = 128.0 + 0.5 * red - 0.418688 * green - 0.081312 * blue;
    if (cb >= 77.0 && cb <= 127.0 && cr >= 133.0 && cr <= 173.0 && luma > 40.0) {
      skin[i] = true;
      skinCount += 1;
      skinPixels.push([red, green, blue]);
    }
  }
  const skinRatio = skinCount / pixelCount;
  if (skinRatio < 0.30) return { verdict: "not_skin", skinRatio: round4(skinRatio), lesionRatio: 0 };
  const median = [0, 1, 2].map((channel) => {
    const values = skinPixels.map((pixel) => pixel[channel]).sort((a, b) => a - b);
    const mid = values.length >> 1;
    return values.length % 2 === 1 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  });
  const deviations: number[] = [];
  let sum = 0;
  for (let i = 0; i < pixelCount; i += 1) {
    if (!skin[i]) continue;
    const red = data[i * channels] - median[0];
    const green = data[i * channels + 1] - median[1];
    const blue = data[i * channels + 2] - median[2];
    const value = Math.sqrt(red * red + green * green + blue * blue);
    deviations.push(value);
    sum += value;
  }
  const meanDeviation = sum / deviations.length;
  let varianceSum = 0;
  for (const value of deviations) varianceSum += (value - meanDeviation) ** 2;
  const stdDeviation = Math.sqrt(varianceSum / deviations.length);
  const threshold = Math.max(45.0, 2.2 * stdDeviation);
  let lesionCount = 0;
  for (const value of deviations) {
    if (value > threshold) lesionCount += 1;
  }
  const lesionRatio = lesionCount / pixelCount;
  return {
    verdict: lesionRatio >= 0.015 ? "lesion_present" : "normal_skin",
    skinRatio: round4(skinRatio),
    lesionRatio: round4(lesionRatio),
  };
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
