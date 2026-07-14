# Guion E2E ? US7: Multi-usuario m?nimo

> Manual validation guide. Automated unauthenticated smoke coverage lives in `tests/e2e/browser/smoke.spec.ts`.

1. **Initial registration only (FR-060)**: on an empty database, create the first owner account.
2. **Public registration stays closed**: after the first organization exists, any second public sign-up must return 403. Environment variables cannot reopen it.
3. **Team account (FR-061)**: the owner creates a member from Settings ? Team using an email and temporary password.
4. **Member login**: the new member signs in and sees the organization's inbox.
5. **Owner authorization**: a member cannot create more accounts and receives 403.
6. **Rate limit (FR-062)**: more than 10 failed logins from the same IP within 10 minutes returns 429 without leaking account details.

Do not mark this guide as executed until the owner/member flow has been repeated on the release candidate.
