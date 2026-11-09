# Contributing

Thanks for helping. Bug reports, missed data types, new sites and translations are all welcome.

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on the approach.
- Never put real personal data in issues, tests, fixtures or screenshots. Use made-up names,
  `example.com` addresses and test card numbers such as `4111 1111 1111 1111`.
- Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## Setup

```sh
npm ci
npm run setup   # onnxruntime-web and pdf.js into vendor/
npm run model   # optional, the name and address model, see docs/MODEL.md
```

Load the folder as an unpacked extension in `chrome://extensions`.

## Checks

Run before opening a pull request:

```sh
npm test
npm run e2e:files && npm run e2e:policy && npm run e2e:sites
npm run e2e          # needs the model
```

A change to detection needs a unit test in `test/detector.test.js` with a positive and a negative
example. A change to what goes over the network needs an e2e check that looks at the request the
site actually receives.

## Style

Plain JavaScript, no build step, no new runtime dependencies without discussion. The extension
code is shipped as is and must stay readable in the published package. Interface strings go into
`src/i18n.js` in all three languages (English, Italian, Russian).

## License of contributions

Velami is licensed under AGPL-3.0, and Via-Tech also offers it under a commercial license. By
submitting a pull request you confirm that you wrote the change, and you agree that Via-Tech may
distribute it under both the AGPL-3.0 and its commercial license.
