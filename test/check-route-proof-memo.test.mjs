import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { checkRouteProofMemo } from "../scripts/check-route-proof-memo.mjs";

const fixtureUrl = new URL("./fixtures/route-proof-memo.json", import.meta.url);
const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8"));
const scriptUrl = new URL("../scripts/check-route-proof-memo.mjs", import.meta.url);
const scriptPath = fileURLToPath(scriptUrl);
const fixturePath = fileURLToPath(fixtureUrl);

describe("route-proof memo checker", () => {
  it("accepts the fixture memo", () => {
    const result = checkRouteProofMemo(fixture);
    assert.equal(result.match, true);
    assert.deepEqual(result.reasons, []);
  });

  it("accepts the fixture as memo JSON text", () => {
    const result = checkRouteProofMemo(JSON.stringify(fixture));
    assert.equal(result.match, true);
  });

  it("accepts extra audit fields that are not a measurement or a profile", () => {
    const result = checkRouteProofMemo({
      ...fixture,
      app: "everyway",
      version: 1,
      worldEpoch: "epoch-1",
      source: "sensor",
      edgeId: "edge-north-ramp",
      routeEdgeIds: [],
    });
    assert.equal(result.match, true);
  });

  it("rejects a raw distance measurement without echoing its value", () => {
    const result = checkRouteProofMemo({ ...fixture, distanceMm: 84 });
    assert.equal(result.match, false);
    assert.deepEqual(result.reasons, ["memo contains a raw distance measurement (distanceMm)"]);
  });

  it("rejects a nested user profile", () => {
    const result = checkRouteProofMemo({ ...fixture, profile: { avoidStairs: true } });
    assert.equal(result.match, false);
    assert.ok(result.reasons.some((reason) => reason.includes("user profile")));
  });

  it("rejects a missing route status, bad revision, bad edge ids, and a short evidence hash", () => {
    const { routeStatus, ...rest } = fixture;
    const result = checkRouteProofMemo({
      ...rest,
      revision: "2",
      routeEdgeIds: [""],
      evidenceSha256: "deadbeef",
    });
    assert.equal(result.match, false);
    assert.deepEqual(result.reasons, [
      "revision is not a non-negative integer",
      "route status is missing",
      "edge ids must be an array of non-empty strings",
      "evidence hash is not a SHA-256 hex digest",
    ]);
  });

  it("does not contact a network or read keys", () => {
    const source = readFileSync(scriptUrl, "utf8");
    assert.equal(source.includes("fetch("), false);
    assert.equal(source.includes("http://"), false);
    assert.equal(source.includes("https://"), false);
    assert.equal(source.includes("@solana"), false);
    assert.equal(source.includes("process.env"), false);
    assert.equal(source.includes("keypair"), false);
    assert.match(source, /does not pay, mint,\n \* or hold keys/);
  });

  it("CLI prints match for the fixture and does not print payload values", () => {
    const match = spawnSync(process.execPath, [scriptPath, fixturePath], { encoding: "utf8" });
    assert.equal(match.status, 0);
    assert.equal(match.stdout, "match\n");

    const secret = "sk-test-should-not-print";
    const mismatch = spawnSync(process.execPath, ["scripts/check-route-proof-memo.mjs"], {
      encoding: "utf8",
      input: JSON.stringify({ ...fixture, distanceMm: 84, note: secret }),
    });
    assert.equal(mismatch.status, 1);
    assert.equal(mismatch.stdout.includes(secret), false);
    assert.equal(mismatch.stderr.includes(secret), false);
    assert.equal(mismatch.stdout.includes("84"), false);
    assert.match(mismatch.stdout, /^mismatch\n/);
  });
});
