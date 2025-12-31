export function normalizeJobsResponse(payload) {
  if (!payload || !Array.isArray(payload.jobs)) {
    throw new Error("Invalid jobs response");
  }

  return payload.jobs.map((job, index) => {
    if (!job || typeof job.url !== "string" || job.url.trim() === "") {
      throw new Error("Invalid job url");
    }

    return {
      id: job.id ?? `job-${index + 1}`,
      url: job.url
    };
  });
}

export function getJobAt(jobs, index) {
  if (!Array.isArray(jobs)) return null;
  if (index < 0 || index >= jobs.length) return null;
  return jobs[index];
}
