import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { BORROWER_UI_HTML } from "../src/ui/pages/borrower.ts";
import { ADVISOR_UI_HTML } from "../src/ui/pages/advisor-workspace.ts";
import { SHARE_UI_HTML } from "../src/ui/pages/share.ts";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("V0.9.10B presentation assembly parity", () => {
  it("keeps borrower HTML identical to the V0.9.10A extracted template", () => {
    assert.equal(sha256(BORROWER_UI_HTML), "a28ae78d0ae30734ae412906452a0a6135e6f32aeaf5e2ac24df99cb50da622d");
  });
  it("keeps advisor workspace HTML identical to the V0.9.10A extracted template", () => {
    assert.equal(sha256(ADVISOR_UI_HTML), "cc906ec981cad04ce5ab5b168abf54fd21a073c8ca38942e2201deb3a032b0e5");
  });
  it("keeps share HTML identical to the V0.9.10A extracted template", () => {
    assert.equal(sha256(SHARE_UI_HTML), "84bb3a3feb14cb0da511eb19e3ccac3162dd546912295baeab5f8c14ad770f36");
  });
});
