import test from "node:test";
import assert from "node:assert/strict";

import { matchesJobSearch, searchTokens } from "./job-search.js";

const job = { company: "字节跳动", position: "产品运营实习生" };

test("job search matches partial company and position keywords", () => {
  assert.equal(matchesJobSearch(job, "字节"), true);
  assert.equal(matchesJobSearch(job, "产品"), true);
  assert.equal(matchesJobSearch(job, "运营实习"), true);
});

test("job search is case-insensitive for latin text", () => {
  assert.equal(matchesJobSearch({ company: "Microsoft", position: "Data Analyst" }, "micro data"), true);
  assert.equal(matchesJobSearch({ company: "Microsoft", position: "Data Analyst" }, "SOFT analyst"), true);
});

test("job search requires every typed token to match", () => {
  assert.equal(matchesJobSearch(job, "字节 产品"), true);
  assert.equal(matchesJobSearch(job, "字节 后端"), false);
});

test("empty job search keeps all jobs visible", () => {
  assert.equal(matchesJobSearch(job, "  "), true);
  assert.deepEqual(searchTokens("  字节   产品  "), ["字节", "产品"]);
});
