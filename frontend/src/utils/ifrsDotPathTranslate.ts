/**
 * Translate CompanyOnboarding dot-path keys → ifrs_line_item_master triples.
 * Keep backend/app/data/ifrs_dot_path_map.json in sync with src/data/ifrs_dot_path_map.json
 */
import mapData from "../data/ifrs_dot_path_map.json";

export type MatchQuality = "exact" | "best_fit" | "unmapped" | "unknown";

export type MasterTriple = {
  ifrs_statement: string;
  ifrs_section: string;
  ifrs_line_item: string;
  match_quality: MatchQuality;
  note?: string;
};

export type TranslateResult =
  | { ok: true; dot_path: string; triple: MasterTriple }
  | { ok: false; dot_path: string; match_quality: MatchQuality; note?: string; error: string };

const MAPPINGS = mapData.mappings as Record<
  string,
  {
    ifrs_statement: string | null;
    ifrs_section: string | null;
    ifrs_line_item: string | null;
    match_quality: MatchQuality;
    note?: string;
  }
>;

export function translateDotPath(dotPath: string): TranslateResult {
  const raw = (dotPath || "").trim();
  const entry = MAPPINGS[raw];
  if (!entry) {
    console.warn(`ifrsDotPathTranslate: unknown dot-path ${raw}`);
    return { ok: false, dot_path: raw, match_quality: "unknown", error: `Unknown dot-path: ${raw}` };
  }
  if (entry.match_quality === "unmapped" || !entry.ifrs_line_item) {
    console.warn(`ifrsDotPathTranslate: unmapped dot-path ${raw}`, entry.note);
    return {
      ok: false,
      dot_path: raw,
      match_quality: "unmapped",
      note: entry.note,
      error: entry.note || "No master line item mapping",
    };
  }
  if (entry.match_quality === "best_fit") {
    console.info(`ifrsDotPathTranslate: best_fit ${raw} → ${entry.ifrs_line_item}`, entry.note);
  }
  return {
    ok: true,
    dot_path: raw,
    triple: {
      ifrs_statement: entry.ifrs_statement!,
      ifrs_section: entry.ifrs_section!,
      ifrs_line_item: entry.ifrs_line_item!,
      match_quality: entry.match_quality,
      note: entry.note,
    },
  };
}

export type CoaTemplateEntry = {
  gl_code: string;
  gl_description: string;
  ifrs_statement: string;
  ifrs_section: string;
  ifrs_line_item: string;
  dot_path?: string;
  match_quality?: MatchQuality;
};

export function translateOnboardingMappings(
  chartOfAccounts: Array<{ glCode: string; accountName: string }>,
  mappings: Record<string, string>
): {
  entries: CoaTemplateEntry[];
  failures: TranslateResult[];
  skippedGlCodes: Array<{ glCode: string; accountName: string; reason: string }>;
} {
  const entries: CoaTemplateEntry[] = [];
  const failures: TranslateResult[] = [];
  const skippedGlCodes: Array<{ glCode: string; accountName: string; reason: string }> = [];
  for (const row of chartOfAccounts) {
    const dotPath = mappings[row.glCode];
    if (!dotPath) {
      skippedGlCodes.push({
        glCode: row.glCode,
        accountName: row.accountName,
        reason: "No IFRS mapping selected for this GL code",
      });
      continue;
    }
    const tr = translateDotPath(dotPath);
    if (!tr.ok) {
      failures.push(tr);
      continue;
    }
    entries.push({
      gl_code: row.glCode,
      gl_description: row.accountName,
      ifrs_statement: tr.triple.ifrs_statement,
      ifrs_section: tr.triple.ifrs_section,
      ifrs_line_item: tr.triple.ifrs_line_item,
      dot_path: dotPath,
      match_quality: tr.triple.match_quality,
    });
  }
  return { entries, failures, skippedGlCodes };
}

export function listUnmappedDotPaths(): string[] {
  return Object.entries(MAPPINGS)
    .filter(([, v]) => v.match_quality === "unmapped")
    .map(([k]) => k);
}
