# Marketplace readiness

This document tracks what's in place toward BigCommerce Marketplace listing versus what remains.
**This app has not been submitted to or approved for the BigCommerce Marketplace.** Marketplace
approval is an external BigCommerce review process this document cannot grant or predict the
outcome of.

## Already in place

- OAuth install/load/uninstall/remove-user callbacks, all with signature verification
- Least-privilege scope request (`Products: Modify` only), documented justification
- Multi-user support with owner/staff role distinction
- No use of third-party iframe cookies for the embedded session
- Encrypted-at-rest storage for all third-party credentials
- Uninstall behavior that never deletes merchant data (BigCommerce products)
- A documented data-retention policy and manual full-deletion procedure
- Structured audit logging for sensitive actions
- `SECURITY.md` with a vulnerability-reporting process
- No secrets committed to source control; `.env.example` contains only placeholders

## Gaps to close before a real submission

- **Legal**: Terms of Service and Privacy Policy documents (none exist in this repo — these are
  business/legal artifacts outside an engineering deliverable's scope).
- **Support**: a published support contact/process for merchants (this repo's issue tracker is
  not a substitute for the support channel BigCommerce requires listed apps to provide).
- **Billing**: this app has no billing integration (explicitly out of scope for this release —
  see the README's exclusions). A paid listing requires BigCommerce's billing API integration.
  A free listing does not, but Marketplace review still expects a clear indication of pricing.
- **App icon / marketing assets**: none included; required for a Marketplace listing page.
- **Extended QA**: BigCommerce's own review process tests against real store data at a scale and
  variety this repo's test suite (mock-mode fixtures, a modest integration/E2E suite) doesn't
  replicate. Expect review feedback requiring fixes regardless of how much local testing passes.
- **Uptime/monitoring commitments**: BigCommerce Marketplace listings are expected to meet
  certain reliability bars; this repo provides the building blocks (health checks, structured
  logs, optional Sentry/OTel) but no SLA or on-call process — that's an operational commitment,
  not a code deliverable.
- **Rate-limit behavior at scale**: the in-memory rate limiter (see README) needs revisiting if
  the web service is horizontally scaled — a Marketplace-scale deployment likely needs a shared
  (e.g. Redis-backed) limiter instead.

## Recommendation

Treat this codebase as a solid, security-conscious foundation for a Marketplace submission, not
a submission-ready package on its own. The gaps above are largely business/operational, not
architectural — closing them doesn't require redesigning the app.
