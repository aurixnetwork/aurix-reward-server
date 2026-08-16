export function parseClaimAuthorizationJobId(args: readonly string[]): string {
  let jobId: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument !== "--authorization-job-id") {
      throw new Error(`Unknown claim argument: ${argument ?? ""}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("--authorization-job-id requires a UUID value");
    }
    if (jobId) throw new Error("--authorization-job-id may be supplied only once");
    jobId = value;
    index += 1;
  }
  if (!jobId) throw new Error("--authorization-job-id is required");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
    throw new Error("--authorization-job-id must be a canonical UUID");
  }
  return jobId;
}
