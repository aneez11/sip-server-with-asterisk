export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly errors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function assert(cond: unknown, status: number, message: string): asserts cond {
  if (!cond) throw new ApiError(status, message);
}
