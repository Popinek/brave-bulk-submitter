# Security

## Scope

Brave Bulk Submitter is designed to run locally for public URLs. It is loopback-only, has no login system, and does not persist credentials or browser state.

## Built-in safeguards

- The server refuses to bind to non-loopback interfaces.
- Requests with non-loopback Host headers or cross-origin browser origins are rejected.
- State-changing API endpoints require `application/json`.
- Queue validation rejects embedded URL credentials, local hostnames, and non-public/special-use literal IPv4 and IPv6 addresses.
- The browser context is ephemeral and queue/activity state is kept in memory.

These checks are defense in depth for a local utility. Do not expose the app through a reverse proxy, tunnel, port-forward, or other network-facing setup without adding authentication and a separate security review.

## Safe usage

- Only submit URLs you are authorized to send to Brave Search.
- Do not paste passwords, session tokens, private URLs, or API keys into the queue.
- Use the visible browser to handle any human verification requested by Brave.
- Review the queue before starting a run.
- Keep `.env`, browser profiles, private URL lists, and logs out of version control.

## Reporting a vulnerability

Please report security issues privately to the repository owner. Do not publish credentials, cookies, private URLs, or other sensitive data in an issue.
