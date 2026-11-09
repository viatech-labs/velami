# Security policy

Velami handles personal data, so we treat every report seriously.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private reporting
([Security → Report a vulnerability](https://github.com/viatech-labs/velami/security/advisories/new))
or write to info@via-tech.org with "Velami security" in the subject.

Useful to include: the Velami version, Chrome version and OS, the AI site, steps to reproduce, and
what data could leave the computer. Use made-up data in screenshots and logs, never real personal
data.

We reply within 3 working days, agree on a fix date with you, and credit you in the release notes
unless you prefer otherwise.

## In scope

- personal data reaching an AI site or any other address without being replaced;
- a page script reading the label vault or the real values through the extension;
- the extension making network requests other than those described in [PRIVACY.md](PRIVACY.md);
- a published package that does not match the sources (`npm run verify`);
- bypassing an organization policy (`chrome.storage.managed`) from the page.

## Out of scope

The threat model in the [README](README.md#threat-model) applies. A chat page that deliberately
reads the input field and sends it on its own, for example encrypted, is a known limit of any
browser extension. Missed names or addresses are quality issues, please report them as normal
issues with a made-up example.

## Supported versions

Only the latest release gets security fixes.
