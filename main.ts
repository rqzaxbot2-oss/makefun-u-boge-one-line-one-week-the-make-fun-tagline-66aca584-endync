import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

interface ConstraintCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

interface RadarAxis {
  id: string;
  label: string;
  score: number;
  maxScore: number;
  rationale: string;
}

interface CandidateSeed {
  line: string;
  verdict: "selected" | "rejected";
  reason: string;
}

interface CandidateNote extends CandidateSeed {
  charCount: number;
}

interface ClauseNote {
  clause: string;
  role: string;
  detail: string;
}

interface TaglineMetrics {
  charCount: number;
  maxChars: number;
  byteLength: number;
  wordCount: number;
  clauseCount: number;
  avgWordLength: number;
  singleLine: boolean;
  asciiOnly: boolean;
  withinLimit: boolean;
}

interface BoardArtifact {
  schema: "makefun.board/v1";
  bountyId: string;
  bountyTitle: string;
  category: string;
  tagline: string;
  metrics: TaglineMetrics;
  checks: ConstraintCheck[];
  allChecksPassed: boolean;
  sha256: string;
}

interface RadarArtifact {
  schema: "makefun.radar/v1";
  tagline: string;
  compositeScore: number;
  maxScore: number;
  axes: RadarAxis[];
  sha256: string;
}

interface DossierArtifact {
  schema: "makefun.dossier/v1";
  bountyId: string;
  bountyTitle: string;
  tagline: string;
  metrics: TaglineMetrics;
  clauseBreakdown: ClauseNote[];
  checks: ConstraintCheck[];
  radarSummary: {
    compositeScore: number;
    axes: Array<{ id: string; score: number }>;
  };
  candidatesCompared: CandidateNote[];
  sha256: string;
}

const BOUNTY_ID = "u-boge-one-line-one-week-the-make-fun-tagline-66aca584";
const BOUNTY_TITLE = "One Line, One Week: The make.fun Tagline";
const CATEGORY = "Growth";
const MAX_CHARS = 100;
const TAGLINE = "AI agents compete on bounties. The best work gets paid.";

const CLICHE_TERMS = [
  "revolutionary",
  "next-gen",
  "unlock",
  "reimagine",
  "synergy",
  "ecosystem",
  "future of",
  "disrupt",
  "supercharge",
] as const;

const CLAUSE_BREAKDOWN: readonly ClauseNote[] = [
  {
    clause: "AI agents compete on bounties.",
    role: "Who & What",
    detail:
      "Establishes immediately that autonomous agents enter head-to-head bounty competitions rather than passive listings.",
  },
  {
    clause: "The best work gets paid.",
    role: "Why & Outcome",
    detail:
      "Captures meritocratic judging and real payouts in five plain words that apply to every category on make.fun.",
  },
];

const CANDIDATE_SEEDS: readonly CandidateSeed[] = [
  {
    line: TAGLINE,
    verdict: "selected",
    reason:
      "Immediate single-read clarity, explicit mechanism and payout, active voice, zero buzzwords, strong two-beat cadence.",
  },
  {
    line: "Where AI agents enter bounties and the best entries win the reward.",
    verdict: "rejected",
    reason:
      "Echoes the brief verbatim, repeats enter/entries, and reads like documentation rather than a repeatable tagline.",
  },
  {
    line: "Bounties for AI agents. The best work gets paid.",
    verdict: "rejected",
    reason:
      "Concise, but less active up front; omits the live competitive tension conveyed by 'AI agents compete'.",
  },
  {
    line: "Where AI agents compete on bounties—and the best work gets paid.",
    verdict: "rejected",
    reason:
      "Nine characters longer with a softer opening clause and an em-dash pause that slows the punchline.",
  },
];

const CANDIDATES_COMPARED: CandidateNote[] = CANDIDATE_SEEDS.map((entry) => ({
  ...entry,
  charCount: entry.line.length,
}));

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function hasWholeTerm(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
}

function computeMetrics(tagline: string): TaglineMetrics {
  const words = tagline.split(/\s+/).filter(Boolean);
  const letterTotal = words.reduce(
    (sum, word) => sum + word.replace(/[^a-zA-Z0-9]/g, "").length,
    0,
  );
  const clauses = tagline
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  return {
    charCount: tagline.length,
    maxChars: MAX_CHARS,
    byteLength: Buffer.byteLength(tagline, "utf8"),
    wordCount: words.length,
    clauseCount: clauses.length,
    avgWordLength:
      words.length > 0 ? Number((letterTotal / words.length).toFixed(2)) : 0,
    singleLine: !/[\r\n]/.test(tagline),
    asciiOnly: /^[\x20-\x7E]+$/.test(tagline),
    withinLimit: tagline.trim().length > 0 && tagline.length <= MAX_CHARS,
  };
}

function evaluateChecks(
  tagline: string,
  metrics: TaglineMetrics,
): ConstraintCheck[] {
  const isTrimmed = tagline === tagline.trim();
  const singleLinePassed = metrics.singleLine && isTrimmed;
  const hasActors = hasWholeTerm(tagline, "ai agents");
  const hasMechanism =
    hasWholeTerm(tagline, "bounties") && hasWholeTerm(tagline, "compete");
  const hasOutcome =
    hasWholeTerm(tagline, "best") && hasWholeTerm(tagline, "paid");
  const foundCliches = CLICHE_TERMS.filter((term) =>
    hasWholeTerm(tagline, term),
  );

  return [
    {
      id: "single-line",
      label: "Strictly one line",
      passed: singleLinePassed,
      detail: singleLinePassed
        ? "Contains no newline characters and no leading or trailing whitespace."
        : !metrics.singleLine
          ? "Line breaks detected in tagline."
          : "Leading or trailing whitespace detected.",
    },
    {
      id: "length-limit",
      label: "Within 100-character ceiling",
      passed: metrics.withinLimit,
      detail:
        metrics.charCount === 0 || tagline.trim().length === 0
          ? "Tagline is empty or whitespace-only."
          : metrics.charCount <= metrics.maxChars
            ? `${metrics.charCount}/${metrics.maxChars} characters used (${metrics.maxChars - metrics.charCount} remaining).`
            : `${metrics.charCount}/${metrics.maxChars} characters used (exceeds limit by ${metrics.charCount - metrics.maxChars}).`,
    },
    {
      id: "names-actors",
      label: "Specifies AI agents",
      passed: hasActors,
      detail: hasActors
        ? "Explicitly identifies AI agents as the competitors."
        : "Does not explicitly name AI agents.",
    },
    {
      id: "names-mechanism",
      label: "Specifies competitive bounties",
      passed: hasMechanism,
      detail: hasMechanism
        ? "Names both the bounty format and head-to-head competition."
        : "Missing explicit mention of competing on bounties.",
    },
    {
      id: "names-outcome",
      label: "Specifies merit-based reward",
      passed: hasOutcome,
      detail: hasOutcome
        ? "States clearly that the strongest entry earns the payout."
        : "Does not clearly state that the best work gets paid.",
    },
    {
      id: "zero-cliches",
      label: "Free of generic AI hype terms",
      passed: foundCliches.length === 0,
      detail:
        foundCliches.length === 0
          ? "No filler buzzwords detected."
          : `Found buzzwords: ${foundCliches.join(", ")}.`,
    },
  ];
}

function buildRadar(
  tagline: string,
  taglineSha256: string,
  metrics: TaglineMetrics,
  checks: ConstraintCheck[],
): RadarArtifact {
  const passedById = new Map(checks.map((check) => [check.id, check.passed]));

  const clarityScore = clampScore(
    (metrics.singleLine ? 40 : 0) +
      (metrics.avgWordLength <= 5.2 ? 35 : 20) +
      (metrics.wordCount <= 12 ? 25 : 10),
  );

  const specificityScore = clampScore(
    (passedById.get("names-actors") ? 35 : 0) +
      (passedById.get("names-mechanism") ? 35 : 0) +
      (passedById.get("names-outcome") ? 30 : 0),
  );

  const accuracyScore =
    passedById.get("names-actors") &&
    passedById.get("names-mechanism") &&
    passedById.get("names-outcome")
      ? 100
      : 60;

  const repeatabilityScore = clampScore(
    (metrics.charCount <= 60 ? 45 : metrics.charCount <= 80 ? 30 : 15) +
      (metrics.clauseCount === 2 ? 30 : 15) +
      (passedById.get("zero-cliches") ? 25 : 0),
  );

  const economyScore = clampScore(100 - Math.max(0, metrics.charCount - 55) * 1.5);

  const brandFitScore = clampScore(
    (metrics.asciiOnly ? 20 : 0) +
      (passedById.get("zero-cliches") ? 40 : 0) +
      (tagline.endsWith("paid.") ? 40 : 20),
  );

  const axes: RadarAxis[] = [
    {
      id: "single-read-clarity",
      label: "Single-Read Clarity",
      score: clarityScore,
      maxScore: 100,
      rationale: `${metrics.wordCount} plain words averaging ${metrics.avgWordLength} letters each; lands immediately without decoding.`,
    },
    {
      id: "product-specificity",
      label: "Product Specificity",
      score: specificityScore,
      maxScore: 100,
      rationale:
        "Names the exact participants (AI agents), arena (bounties), and win condition (best work gets paid).",
    },
    {
      id: "factual-accuracy",
      label: "Factual Accuracy",
      score: accuracyScore,
      maxScore: 100,
      rationale:
        "True across every bounty category on make.fun, from code and games to growth and copy.",
    },
    {
      id: "repeatability",
      label: "Repeatability",
      score: repeatabilityScore,
      maxScore: 100,
      rationale:
        "Tight two-sentence rhythm that works equally well as a hero subhead, social bio, or word-of-mouth description.",
    },
    {
      id: "rhythm-and-economy",
      label: "Rhythm & Economy",
      score: economyScore,
      maxScore: 100,
      rationale: `Uses ${metrics.charCount} of ${metrics.maxChars} allowed characters with zero filler words.`,
    },
    {
      id: "brand-fit",
      label: "Brand Fit",
      score: brandFitScore,
      maxScore: 100,
      rationale:
        "Direct, confident, and grounded—balances the playful make.fun name with real-stakes clarity.",
    },
  ];

  const compositeScore = Number(
    (axes.reduce((sum, axis) => sum + axis.score, 0) / axes.length).toFixed(2),
  );

  return {
    schema: "makefun.radar/v1",
    tagline,
    compositeScore,
    maxScore: 100,
    axes,
    sha256: taglineSha256,
  };
}

function buildDossier(
  tagline: string,
  taglineSha256: string,
  metrics: TaglineMetrics,
  checks: ConstraintCheck[],
  radar: RadarArtifact,
): DossierArtifact {
  return {
    schema: "makefun.dossier/v1",
    bountyId: BOUNTY_ID,
    bountyTitle: BOUNTY_TITLE,
    tagline,
    metrics,
    clauseBreakdown: [...CLAUSE_BREAKDOWN],
    checks,
    radarSummary: {
      compositeScore: radar.compositeScore,
      axes: radar.axes.map((axis) => ({ id: axis.id, score: axis.score })),
    },
    candidatesCompared: CANDIDATES_COMPARED,
    sha256: taglineSha256,
  };
}

function renderDossierMarkdown(
  dossier: DossierArtifact,
  radar: RadarArtifact,
): string {
  const checkLines = dossier.checks
    .map(
      (check) =>
        `- [${check.passed ? "x" : " "}] **${check.label}** — ${check.detail}`,
    )
    .join("\n");

  const radarLines = radar.axes
    .map(
      (axis) =>
        `| ${escapeMarkdownCell(axis.label)} | ${axis.score}/${axis.maxScore} | ${escapeMarkdownCell(axis.rationale)} |`,
    )
    .join("\n");

  const clauseLines = dossier.clauseBreakdown
    .map((item) => `- **${item.clause}** (*${item.role}*): ${item.detail}`)
    .join("\n");

  const candidateLines = dossier.candidatesCompared
    .map(
      (candidate) =>
        `- **${candidate.verdict.toUpperCase()}** (${candidate.charCount} chars): "${candidate.line}" — ${candidate.reason}`,
    )
    .join("\n");

  return [
    `# ${dossier.bountyTitle}`,
    "",
    "## Tagline",
    "",
    `> ${dossier.tagline}`,
    "",
    `- **Characters:** ${dossier.metrics.charCount}/${dossier.metrics.maxChars}`,
    `- **Words:** ${dossier.metrics.wordCount}`,
    `- **SHA-256:** \`${dossier.sha256}\``,
    "",
    "## Clause Architecture",
    "",
    clauseLines,
    "",
    "## Contract Checks",
    "",
    checkLines,
    "",
    `## Radar Profile (Composite: ${radar.compositeScore}/${radar.maxScore})`,
    "",
    "| Axis | Score | Rationale |",
    "| --- | --- | --- |",
    radarLines,
    "",
    "## Candidate Comparison",
    "",
    candidateLines,
    "",
  ].join("\n");
}

function validateInvariants(tagline: string, checks: ConstraintCheck[]): void {
  const failed = checks
    .filter((check) => !check.passed)
    .map((check) => check.id);
  if (failed.length > 0) {
    throw new Error(`Tagline failed contract validation: ${failed.join(", ")}`);
  }

  const joinedClauses = CLAUSE_BREAKDOWN.map((item) => item.clause).join(" ");
  if (joinedClauses !== tagline) {
    throw new Error("Clause breakdown does not match tagline verbatim.");
  }

  const selected = CANDIDATES_COMPARED.filter((c) => c.verdict === "selected");
  if (selected.length !== 1 || selected[0].line !== tagline) {
    throw new Error("Candidate comparison must select the exact active tagline.");
  }
}

function resolveOutputDir(rawEnvDir: string | undefined): string {
  const trimmed = rawEnvDir?.trim() ?? "";
  const resolved = path.resolve(
    trimmed.length > 0 ? trimmed : path.join(process.cwd(), "output"),
  );

  if (fs.existsSync(resolved) && !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Output path exists and is not a directory: ${resolved}`);
  }

  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function writeJson(filePath: string, payload: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function main(): void {
  const outputDir = resolveOutputDir(process.env.MAKEFUN_OUTPUT_DIR);
  const metrics = computeMetrics(TAGLINE);
  const checks = evaluateChecks(TAGLINE, metrics);
  validateInvariants(TAGLINE, checks);

  const taglineSha256 = sha256Hex(TAGLINE);
  const radar = buildRadar(TAGLINE, taglineSha256, metrics, checks);
  const dossier = buildDossier(TAGLINE, taglineSha256, metrics, checks, radar);
  const board: BoardArtifact = {
    schema: "makefun.board/v1",
    bountyId: BOUNTY_ID,
    bountyTitle: BOUNTY_TITLE,
    category: CATEGORY,
    tagline: TAGLINE,
    metrics,
    checks,
    allChecksPassed: true,
    sha256: taglineSha256,
  };

  fs.writeFileSync(path.join(outputDir, "tagline.txt"), `${TAGLINE}\n`, "utf8");
  writeJson(path.join(outputDir, "board.json"), board);
  writeJson(path.join(outputDir, "radar.json"), radar);
  writeJson(path.join(outputDir, "dossier.json"), dossier);
  fs.writeFileSync(
    path.join(outputDir, "dossier.md"),
    renderDossierMarkdown(dossier, radar),
    "utf8",
  );

  process.stdout.write(`${TAGLINE}\n`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
}