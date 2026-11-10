#!/usr/bin/env node
// Открывает отдельный профиль Chrome для тестов на живых сайтах и вкладки входа на каждый сайт.
// Коды и ссылки входа приходят на qa@velami.pro: почта Titan открыта в первой вкладке того же профиля.
// Войдите в каждую вкладку и закройте окно: сессии останутся в профиле, тесты возьмут их оттуда.
// Профиль лежит вне репозитория и содержит куки тестовых аккаунтов, его нельзя никуда копировать.
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer';

export const QA_PROFILE = path.join(os.homedir(), 'Library', 'Application Support', 'velami-qa-chrome');

const URLS = [
  'https://app.titan.email/',
  'https://claude.ai/login',
  'https://chatgpt.com/auth/login',
  'https://gemini.google.com/app',
  'https://www.perplexity.ai/',
  'https://chat.mistral.ai/chat',
  'https://chat.deepseek.com/',
  'https://copilot.microsoft.com/',
  'https://grok.com/',
];

const browser = await puppeteer.launch({
  headless: false,
  userDataDir: QA_PROFILE,
  defaultViewport: null,
  ignoreDefaultArgs: ['--enable-automation'],
  args: ['--disable-blink-features=AutomationControlled', '--no-first-run'],
});
const [first] = await browser.pages();
await first.goto(URLS[0]);
for (const url of URLS.slice(1)) await (await browser.newPage()).goto(url).catch(() => {});
console.log(`Профиль: ${QA_PROFILE}\nВойдите на всех вкладках и закройте окно Chrome.`);
await new Promise((resolve) => browser.on('disconnected', resolve));
