/**
 * Read-only checker for a public Solana route-proof memo.
 *
 * Harbor stays outside the product loop, so this file does not pay, mint,
 * or hold keys. It does not submit transactions or contact a cluster.
 * Contract authority stays in conduit/contracts. Nothing here copies those
 * schemas or decides route, obstruction, or payout rules.
 *
 * The expected contents are the ones named in conduit docs/SOLANA.md:
 * venue, world revision, obstruction and route status, route edge ids, and
 * a SHA-256 digest of the off-chain observation and route. The memo must
 * not carry a raw distance measurement or a user profile. The digest is
 * checked only as 64 lowercase hex characters. This checker does not
 * recompute it and does not read the off-chain observation.
 *
 * Public memo keys for those contents:
 * venueId, revision, obstructionState, routeStatus, routeEdgeIds,
 * evidenceSha256.
 * Other keys are allowed unless they are a raw distance or a profile.
 */
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DISTANCE_KEYS = new Set(["distance", "distanceCm", "distanceMm"]);
const PROFILE_KEYS = new Set(["profile", "profileVersion", "userProfile"]);

/**
 * @param {unknown} payload Parsed memo object, or the memo's JSON text.
 * @returns {{ match: boolean, reasons: string[] }}
 */
export function checkRouteProofMemo(payload) {
  const memo = parseMemo(payload);
  if (memo.reasons) return { match: false, reasons: memo.reasons };

  const reasons = [];
  collectForbidden(memo.value, reasons);
  checkVenue(memo.value, reasons);
  checkRevision(memo.value, reasons);
  checkObstructionStatus(memo.value, reasons);
  checkRouteStatus(memo.value, reasons);
  checkEdgeIds(memo.value, reasons);
  checkEvidenceHash(memo.value, reasons);
  return { match: reasons.length === 0, reasons };
}

/**
 * @param {unknown} payload
 * @returns {{ value: Record<string, unknown> } | { reasons: string[] }}
 */
function parseMemo(payload) {
  let memo = payload;
  if (typeof payload === "string") {
    try {
      memo = JSON.parse(payload);
    } catch {
      return { reasons: ["memo is not JSON"] };
    }
  }
  if (memo === null || typeof memo !== "object" || Array.isArray(memo)) {
    return { reasons: ["memo is not an object"] };
  }
  return { value: /** @type {Record<string, unknown>} */ (memo) };
}

/**
 * @param {unknown} value
 * @param {string[]} reasons
 * @param {Set<object>} [seen]
 */
function collectForbidden(value, reasons, seen = new Set()) {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  const entries = Array.isArray(value)
    ? value.map((item) => /** @type {[string, unknown]} */ (["", item]))
    : Object.entries(value);
  for (const [key, child] of entries) {
    if (key && DISTANCE_KEYS.has(key)) {
      reasons.push(`memo contains a raw distance measurement (${key})`);
    } else if (key && PROFILE_KEYS.has(key)) {
      reasons.push(`memo contains a user profile (${key})`);
    }
    collectForbidden(child, reasons, seen);
  }
}

/**
 * @param {Record<string, unknown>} memo
 * @param {string[]} reasons
 */
function checkVenue(memo, reasons) {
  if (!isNonEmptyString(memo.venueId)) reasons.push("venue is missing");
}

/**
 * @param {Record<string, unknown>} memo
 * @param {string[]} reasons
 */
function checkRevision(memo, reasons) {
  if (!isNonNegativeInteger(memo.revision)) {
    reasons.push("revision is not a non-negative integer");
  }
}

/**
 * @param {Record<string, unknown>} memo
 * @param {string[]} reasons
 */
function checkObstructionStatus(memo, reasons) {
  if (!isNonEmptyString(memo.obstructionState)) {
    reasons.push("obstruction status is missing");
  }
}

/**
 * @param {Record<string, unknown>} memo
 * @param {string[]} reasons
 */
function checkRouteStatus(memo, reasons) {
  if (!isNonEmptyString(memo.routeStatus)) reasons.push("route status is missing");
}

/**
 * @param {Record<string, unknown>} memo
 * @param {string[]} reasons
 */
function checkEdgeIds(memo, reasons) {
  const edgeIds = memo.routeEdgeIds;
  if (!Array.isArray(edgeIds) || edgeIds.some((id) => !isNonEmptyString(id))) {
    reasons.push("edge ids must be an array of non-empty strings");
  }
}

/**
 * @param {Record<string, unknown>} memo
 * @param {string[]} reasons
 */
function checkEvidenceHash(memo, reasons) {
  if (typeof memo.evidenceSha256 !== "string" || !/^[0-9a-f]{64}$/.test(memo.evidenceSha256)) {
    reasons.push("evidence hash is not a SHA-256 hex digest");
  }
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isNonNegativeInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function readCliInput() {
  const file = process.argv[2];
  if (file) return readFileSync(file, "utf8");
  if (!process.stdin.isTTY) return readFileSync(0, "utf8");
  process.stderr.write("usage: node scripts/check-route-proof-memo.mjs <memo.json>\n");
  process.exit(2);
}

function main() {
  const result = checkRouteProofMemo(readCliInput());
  if (result.match) {
    process.stdout.write("match\n");
    process.exit(0);
  }
  process.stdout.write(`mismatch\n${result.reasons.join("\n")}\n`);
  process.exit(1);
}

function invokedAsCli() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (invokedAsCli()) main();
