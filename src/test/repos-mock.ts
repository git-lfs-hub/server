/** Minimal Repos registry: echoes the request case as the canonical name. */
export function stubRepos() {
  return {
    getByName: () => ({
      resolveName: async (owner: string, repo: string) => `${owner}/${repo.replace(/\.git$/, '')}`,
      isBlocked: async () => false,
    }),
  };
}
