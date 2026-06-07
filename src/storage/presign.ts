import { AwsClient } from 'aws4fetch';

export type PresignR2ObjectInput = {
  method: 'GET' | 'PUT';
  endpoint: string;
  bucket: string;
  key: string;
  accessKeyId: string;
  secretAccessKey: string;
  expiresSeconds: number;
  /** SigV4 `X-Amz-Date` (e.g. `20200101T000000Z`). Omit for current time. */
  datetime?: string;
};

/** Path-style URL: `{endpoint}/{bucket}/{key…}` (slashes in `key` are path segments). */
export function buildR2ObjectUrl(endpoint: string, bucket: string, key: string): URL {
  const base = endpoint.replace(/\/$/, '');
  const u = new URL(base);
  const segments = [bucket, ...key.split('/')].map((s) =>
    encodeURIComponent(s).replace(/%2F/g, '/'),
  );
  u.pathname = `/${segments.join('/')}`;
  return u;
}

/**
 * Presigned GET/PUT URL for R2’s S3-compatible API (query-string SigV4).
 * Uses `aws4fetch` (Workers-friendly).
 */
export async function presignR2ObjectUrl(input: PresignR2ObjectInput): Promise<string> {
  const u = buildR2ObjectUrl(input.endpoint, input.bucket, input.key);
  u.searchParams.set('X-Amz-Expires', String(input.expiresSeconds));

  const aws = new AwsClient({
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey,
    service: 's3',
    region: 'auto',
    retries: 0,
  });

  const signed = await aws.sign(u.toString(), {
    method: input.method,
    aws: {
      signQuery: true,
      service: 's3',
      region: 'auto',
      datetime: input.datetime,
    },
  });
  return signed.url;
}
