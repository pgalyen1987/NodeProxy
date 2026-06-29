import { Constants } from 'mppx/server';

/** True when the request carries an MPP `Authorization: Payment …` credential. */
export function hasMppCredential(request: Request): boolean {
  const header = request.headers.get(Constants.Headers.authorization);
  return Boolean(header && /^Payment\s+/i.test(header));
}

export function responseHeaderRecord(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}
