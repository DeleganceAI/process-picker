import http from 'node:http';

// fetch overwrites Sec-Fetch-Mode; these tests need real navigation metadata.
export function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, res => {
      res.resume();
      res.once('end', () => resolve({ status: res.statusCode, headers: res.headers }));
      res.once('error', reject);
    });
    req.once('error', reject);
    req.end();
  });
}
