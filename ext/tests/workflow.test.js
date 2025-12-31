import assert from "node:assert/strict";
import { test } from "node:test";
import { getJobAt, normalizeJobsResponse } from "../workflow.js";

test("normalizeJobsResponse returns jobs with default ids", () => {
  const jobs = normalizeJobsResponse({
    jobs: [
      { url: "http://example.com/one" },
      { id: "custom", url: "http://example.com/two" }
    ]
  });

  assert.equal(jobs.length, 2);
  assert.deepEqual(jobs[0], { id: "job-1", url: "http://example.com/one" });
  assert.deepEqual(jobs[1], { id: "custom", url: "http://example.com/two" });
});

test("normalizeJobsResponse throws when payload is invalid", () => {
  assert.throws(() => normalizeJobsResponse(null), /Invalid jobs response/);
  assert.throws(() => normalizeJobsResponse({ jobs: "nope" }), /Invalid jobs response/);
});

test("normalizeJobsResponse throws when job url is missing", () => {
  assert.throws(() => normalizeJobsResponse({ jobs: [{}] }), /Invalid job url/);
});

test("getJobAt returns job or null", () => {
  const jobs = [
    { id: "job-1", url: "http://example.com/one" },
    { id: "job-2", url: "http://example.com/two" }
  ];

  assert.deepEqual(getJobAt(jobs, 0), jobs[0]);
  assert.equal(getJobAt(jobs, 2), null);
  assert.equal(getJobAt(null, 0), null);
});
