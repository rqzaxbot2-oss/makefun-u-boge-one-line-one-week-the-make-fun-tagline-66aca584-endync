export type FeatureMap = Record<string, number>;

export type NormalizationMode =
  | "identity"
  | "minMax"
  | "zScore"
  | "rank"
  | "targetRange";

export interface FeatureSpec {
  readonly key: string;
  readonly weight: number;
  readonly mode?: NormalizationMode;
  readonly higherIsBetter?: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly targetMin?: number;
  readonly targetMax?: number;
  readonly clampStd?: number;
}

export interface ScoringCandidate<T = unknown> {
  readonly id: string;
  readonly text: string;
  readonly features: FeatureMap;
  readonly meta?: T;
}

export interface ScoreBreakdown {
  readonly arithmetic: number;
  readonly geometric: number;
  readonly composite: number;
  readonly expectedWinRate: number;
  readonly contributions: FeatureMap;
}

export interface RankedCandidate<T = unknown> {
  readonly rank: number;
  readonly id: string;
  readonly text: string;
  readonly charLength: number;
  readonly wordCount: number;
  readonly rawFeatures: FeatureMap;
  readonly normalizedFeatures: FeatureMap;
  readonly score: number;
  readonly breakdown: ScoreBreakdown;
  readonly marginToNext: number;
  readonly meta?: T;
}

export interface RankingOptions {
  readonly epsilon?: number;
  readonly geometricBlend?: number;
  readonly pairwiseTemperature?: number;
  readonly preferShorterOnTie?: boolean;
  readonly tieBreakerKeys?: readonly string[];
  readonly precision?: number;
}

export const DEFAULT_EPSILON = 1e-9;
export const DEFAULT_PRECISION = 6;
export const DEFAULT_GEOMETRIC_BLEND = 0.2;
export const DEFAULT_PAIRWISE_TEMPERATURE = 0.12;

export function sanitizeNumber(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Object.is(value, -0) ? 0 : value;
}

export function clamp(value: number, min = 0, max = 1): number {
  const safe = sanitizeNumber(value, min);
  if (min > max) {
    return clamp(safe, max, min);
  }
  if (safe < min) {
    return min;
  }
  if (safe > max) {
    return max;
  }
  return Object.is(safe, -0) ? 0 : safe;
}

export function roundFixed(value: number, decimals = DEFAULT_PRECISION): number {
  const safe = sanitizeNumber(value, 0);
  const factor = Math.pow(10, Math.max(0, Math.min(12, Math.trunc(decimals))));
  const rounded = Math.round(safe * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function compareCodeUnits(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

export function compareNumbersDesc(
  a: number,
  b: number,
  epsilon = DEFAULT_EPSILON
): number {
  const safeA = sanitizeNumber(a, 0);
  const safeB = sanitizeNumber(b, 0);
  const diff = safeA - safeB;
  if (Math.abs(diff) <= epsilon) {
    return 0;
  }
  return diff > 0 ? -1 : 1;
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}

export function fnv1aHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function normalizeMinMax(
  values: readonly number[],
  options?: {
    readonly min?: number;
    readonly max?: number;
    readonly higherIsBetter?: boolean;
  }
): number[] {
  if (values.length === 0) {
    return [];
  }
  const safe = values.map((v) => sanitizeNumber(v, 0));
  const higherIsBetter = options?.higherIsBetter ?? true;

  let minVal = options?.min !== undefined ? sanitizeNumber(options.min, 0) : safe[0];
  let maxVal = options?.max !== undefined ? sanitizeNumber(options.max, 0) : safe[0];

  if (options?.min === undefined || options?.max === undefined) {
    for (let i = 1; i < safe.length; i += 1) {
      if (options?.min === undefined && safe[i] < minVal) {
        minVal = safe[i];
      }
      if (options?.max === undefined && safe[i] > maxVal) {
        maxVal = safe[i];
      }
    }
  }

  const span = maxVal - minVal;
  if (span <= DEFAULT_EPSILON) {
    return safe.map(() => 0.5);
  }

  return safe.map((v) => {
    const scaled = clamp((v - minVal) / span, 0, 1);
    return higherIsBetter ? scaled : 1 - scaled;
  });
}

export function normalizeZScore(
  values: readonly number[],
  options?: {
    readonly clampStd?: number;
    readonly higherIsBetter?: boolean;
  }
): number[] {
  if (values.length === 0) {
    return [];
  }
  const safe = values.map((v) => sanitizeNumber(v, 0));
  const clampStd = Math.max(0.5, sanitizeNumber(options?.clampStd ?? 3, 3));
  const higherIsBetter = options?.higherIsBetter ?? true;

  let sum = 0;
  for (let i = 0; i < safe.length; i += 1) {
    sum += safe[i];
  }
  const mean = sum / safe.length;

  let sqDiffSum = 0;
  for (let i = 0; i < safe.length; i += 1) {
    const d = safe[i] - mean;
    sqDiffSum += d * d;
  }
  const std = Math.sqrt(sqDiffSum / safe.length);

  if (std <= DEFAULT_EPSILON) {
    return safe.map(() => 0.5);
  }

  return safe.map((v) => {
    const z = clamp((v - mean) / std, -clampStd, clampStd);
    const unit = (z + clampStd) / (2 * clampStd);
    return higherIsBetter ? unit : 1 - unit;
  });
}

export function normalizeRank(
  values: readonly number[],
  higherIsBetter = true
): number[] {
  const n = values.length;
  if (n === 0) {
    return [];
  }
  if (n === 1) {
    return [1];
  }

  const indexed = values.map((v, index) => ({
    index,
    value: sanitizeNumber(v, 0),
  }));

  indexed.sort((a, b) => {
    const diff = higherIsBetter ? a.value - b.value : b.value - a.value;
    if (Math.abs(diff) <= DEFAULT_EPSILON) {
      return a.index - b.index;
    }
    return diff < 0 ? -1 : 1;
  });

  const result = new Array<number>(n).fill(0);
  let start = 0;
  while (start < n) {
    let end = start;
    while (
      end + 1 < n &&
      Math.abs(indexed[end + 1].value - indexed[start].value) <= DEFAULT_EPSILON
    ) {
      end += 1;
    }
    const avgRank = (start + end) / 2;
    const normalized = avgRank / (n - 1);
    for (let i = start; i <= end; i += 1) {
      result[indexed[i].index] = clamp(normalized, 0, 1);
    }
    start = end + 1;
  }

  return result;
}

export function normalizeTargetRange(
  values: readonly number[],
  targetMin: number,
  targetMax: number,
  falloffSpan?: number
): number[] {
  const low = Math.min(sanitizeNumber(targetMin, 0), sanitizeNumber(targetMax, 0));
  const high = Math.max(sanitizeNumber(targetMin, 0), sanitizeNumber(targetMax, 0));
  const defaultSpan = Math.max(1, (high - low) * 1.5, Math.abs(high) * 0.5);
  const span = Math.max(DEFAULT_EPSILON, sanitizeNumber(falloffSpan ?? defaultSpan, defaultSpan));

  return values.map((raw) => {
    const v = sanitizeNumber(raw, 0);
    if (v >= low && v <= high) {
      return 1;
    }
    const distance = v < low ? low - v : v - high;
    return clamp(1 - distance / span, 0, 1);
  });
}

export function normalizeWeights(weights: FeatureMap): FeatureMap {
  const keys = Object.keys(weights).sort(compareCodeUnits);
  const cleaned: FeatureMap = {};
  let total = 0;

  for (const key of keys) {
    const w = Math.max(0, sanitizeNumber(weights[key], 0));
    cleaned[key] = w;
    total += w;
  }

  if (keys.length === 0) {
    return {};
  }

  if (total <= DEFAULT_EPSILON) {
    const uniform = 1 / keys.length;
    const even: FeatureMap = {};
    for (const key of keys) {
      even[key] = uniform;
    }
    return even;
  }

  const normalized: FeatureMap = {};
  for (const key of keys) {
    normalized[key] = cleaned[key] / total;
  }
  return normalized;
}

export function normalizeFeatureMatrix(
  featureMaps: readonly FeatureMap[],
  specs: readonly FeatureSpec[]
): FeatureMap[] {
  const count = featureMaps.length;
  const output: FeatureMap[] = Array.from({ length: count }, () => ({}));
  const sortedSpecs = [...specs].sort((a, b) => compareCodeUnits(a.key, b.key));

  for (const spec of sortedSpecs) {
    const rawColumn = featureMaps.map((m) => sanitizeNumber(m[spec.key] ?? 0, 0));
    const mode = spec.mode ?? "identity";
    const higherIsBetter = spec.higherIsBetter ?? true;

    let normalizedColumn: number[];
    if (mode === "minMax") {
      normalizedColumn = normalizeMinMax(rawColumn, {
        min: spec.min,
        max: spec.max,
        higherIsBetter,
      });
    } else if (mode === "zScore") {
      normalizedColumn = normalizeZScore(rawColumn, {
        clampStd: spec.clampStd,
        higherIsBetter,
      });
    } else if (mode === "rank") {
      normalizedColumn = normalizeRank(rawColumn, higherIsBetter);
    } else if (mode === "targetRange") {
      normalizedColumn = normalizeTargetRange(
        rawColumn,
        spec.targetMin ?? spec.min ?? 0,
        spec.targetMax ?? spec.max ?? 1
      );
    } else {
      normalizedColumn = rawColumn.map((v) => {
        const clamped = clamp(v, 0, 1);
        return higherIsBetter ? clamped : 1 - clamped;
      });
    }

    for (let i = 0; i < count; i += 1) {
      output[i][spec.key] = clamp(normalizedColumn[i], 0, 1);
    }
  }

  return output;
}

export function computeWeightedSum(
  features: FeatureMap,
  weights: FeatureMap
): { readonly total: number; readonly contributions: FeatureMap } {
  const normalizedWeights = normalizeWeights(weights);
  const keys = Object.keys(normalizedWeights).sort(compareCodeUnits);
  const contributions: FeatureMap = {};
  let total = 0;

  for (const key of keys) {
    const value = clamp(features[key] ?? 0, 0, 1);
    const contrib = value * normalizedWeights[key];
    contributions[key] = contrib;
    total += contrib;
  }

  return {
    total: clamp(total, 0, 1),
    contributions,
  };
}

export function computeWeightedGeometric(
  features: FeatureMap,
  weights: FeatureMap,
  floor = 1e-4
): number {
  const normalizedWeights = normalizeWeights(weights);
  const keys = Object.keys(normalizedWeights).sort(compareCodeUnits);
  if (keys.length === 0) {
    return 0;
  }
  const safeFloor = clamp(floor, 1e-9, 0.1);
  let logSum = 0;

  for (const key of keys) {
    const w = normalizedWeights[key];
    if (w <= DEFAULT_EPSILON) {
      continue;
    }
    const v = Math.max(safeFloor, clamp(features[key] ?? 0, 0, 1));
    logSum += w * Math.log(v);
  }

  return clamp(Math.exp(logSum), 0, 1);
}

export function computePairwiseWinProb(
  scoreA: number,
  scoreB: number,
  temperature = DEFAULT_PAIRWISE_TEMPERATURE
): number {
  const temp = Math.max(1e-4, sanitizeNumber(temperature, DEFAULT_PAIRWISE_TEMPERATURE));
  const diff = sanitizeNumber(scoreA, 0) - sanitizeNumber(scoreB, 0);
  const scaled = clamp(diff / temp, -40, 40);
  return 1 / (1 + Math.exp(-scaled));
}

export function computeExpectedWinRates(
  scores: readonly number[],
  temperature = DEFAULT_PAIRWISE_TEMPERATURE
): number[] {
  const n = scores.length;
  if (n === 0) {
    return [];
  }
  if (n === 1) {
    return [1];
  }

  const rates = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    let winSum = 0;
    for (let j = 0; j < n; j += 1) {
      if (i === j) {
        continue;
      }
      winSum += computePairwiseWinProb(scores[i], scores[j], temperature);
    }
    rates[i] = clamp(winSum / (n - 1), 0, 1);
  }
  return rates;
}

export function compareRankedEntries<T>(
  a: RankedCandidate<T>,
  b: RankedCandidate<T>,
  options?: RankingOptions
): number {
  const epsilon = options?.epsilon ?? DEFAULT_EPSILON;
  const preferShorter = options?.preferShorterOnTie ?? true;
  const tieKeys = options?.tieBreakerKeys ?? [];

  const primary = compareNumbersDesc(a.score, b.score, epsilon);
  if (primary !== 0) {
    return primary;
  }

  const winCmp = compareNumbersDesc(
    a.breakdown.expectedWinRate,
    b.breakdown.expectedWinRate,
    epsilon
  );
  if (winCmp !== 0) {
    return winCmp;
  }

  for (const key of tieKeys) {
    const featCmp = compareNumbersDesc(
      a.normalizedFeatures[key] ?? 0,
      b.normalizedFeatures[key] ?? 0,
      epsilon
    );
    if (featCmp !== 0) {
      return featCmp;
    }
  }

  if (preferShorter) {
    if (a.charLength !== b.charLength) {
      return a.charLength - b.charLength;
    }
    if (a.wordCount !== b.wordCount) {
      return a.wordCount - b.wordCount;
    }
  }

  const textCmp = compareCodeUnits(a.text, b.text);
  if (textCmp !== 0) {
    return textCmp;
  }

  const idCmp = compareCodeUnits(a.id, b.id);
  if (idCmp !== 0) {
    return idCmp;
  }

  return fnv1aHash(a.id + ":" + a.text) - fnv1aHash(b.id + ":" + b.text);
}

export function rankCandidates<T>(
  candidates: readonly ScoringCandidate<T>[],
  specs: readonly FeatureSpec[],
  options?: RankingOptions
): RankedCandidate<T>[] {
  if (candidates.length === 0) {
    return [];
  }

  const precision = options?.precision ?? DEFAULT_PRECISION;
  const blend = clamp(
    options?.geometricBlend ?? DEFAULT_GEOMETRIC_BLEND,
    0,
    1
  );
  const temperature =
    options?.pairwiseTemperature ?? DEFAULT_PAIRWISE_TEMPERATURE;

  const weightMap: FeatureMap = {};
  for (const spec of specs) {
    weightMap[spec.key] = Math.max(0, sanitizeNumber(spec.weight, 0));
  }
  const normalizedWeights = normalizeWeights(weightMap);

  const normalizedMatrix = normalizeFeatureMatrix(
    candidates.map((c) => c.features),
    specs
  );

  const provisional = candidates.map((candidate, idx) => {
    const normFeatures = normalizedMatrix[idx];
    const { total: arithmetic, contributions } = computeWeightedSum(
      normFeatures,
      normalizedWeights
    );
    const geometric = computeWeightedGeometric(normFeatures, normalizedWeights);
    const composite = clamp(
      (1 - blend) * arithmetic + blend * geometric,
      0,
      1
    );
    return {
      candidate,
      normFeatures,
      arithmetic,
      geometric,
      composite,
      contributions,
    };
  });

  const expectedWinRates = computeExpectedWinRates(
    provisional.map((p) => p.composite),
    temperature
  );

  const entries: RankedCandidate<T>[] = provisional.map((item, idx) => {
    const roundedNorm: FeatureMap = {};
    for (const key of Object.keys(item.normFeatures).sort(compareCodeUnits)) {
      roundedNorm[key] = roundFixed(item.normFeatures[key], precision);
    }

    const roundedRaw: FeatureMap = {};
    for (const key of Object.keys(item.candidate.features).sort(compareCodeUnits)) {
      roundedRaw[key] = roundFixed(item.candidate.features[key], precision);
    }

    const roundedContribs: FeatureMap = {};
    for (const key of Object.keys(item.contributions).sort(compareCodeUnits)) {
      roundedContribs[key] = roundFixed(item.contributions[key], precision);
    }

    const compositeRounded = roundFixed(item.composite, precision);
    return {
      rank: 0,
      id: item.candidate.id,
      text: item.candidate.text,
      charLength: item.candidate.text.length,
      wordCount: countWords(item.candidate.text),
      rawFeatures: roundedRaw,
      normalizedFeatures: roundedNorm,
      score: compositeRounded,
      breakdown: {
        arithmetic: roundFixed(item.arithmetic, precision),
        geometric: roundFixed(item.geometric, precision),
        composite: compositeRounded,
        expectedWinRate: roundFixed(expectedWinRates[idx], precision),
        contributions: roundedContribs,
      },
      marginToNext: 0,
      meta: item.candidate.meta,
    };
  });

  entries.sort((a, b) => compareRankedEntries(a, b, options));

  return entries.map((entry, idx) => {
    const nextScore = idx + 1 < entries.length ? entries[idx + 1].score : 0;
    const margin =
      idx + 1 < entries.length
        ? roundFixed(Math.max(0, entry.score - nextScore), precision)
        : 0;
    return {
      ...entry,
      rank: idx + 1,
      marginToNext: margin,
    };
  });
}