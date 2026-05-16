/** R2 `head` always misses (upload / missing-object scenarios). */
export function emptyR2Bucket(): R2Bucket {
  return { head: async () => null } as unknown as R2Bucket;
}

/** `head` returns `{ size }` for listed keys, otherwise `null`. */
export function r2BucketWithHeadSizes(sizes: Record<string, number>): R2Bucket {
  return {
    async head(key: string) {
      const size = sizes[key];
      if (size === undefined) return null;
      return { size } as R2Object;
    },
  } as unknown as R2Bucket;
}
