#!/usr/bin/env node
// Деплой velami.pro в кластер via-tech: node site/deploy.mjs [--dry-run]
// Файлы сайта лежат в ConfigMap (без своего образа), nginx-unprivileged отдаёт их и выбирает язык.
// KUBECONFIG берётся из окружения.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'dist', 'site');
const NS = 'velami';
const IMAGE = 'docker.io/nginxinc/nginx-unprivileged:1.27.5-alpine';
const HOSTS = ['velami.pro', 'www.velami.pro'];
const LIMIT = 700 * 1024;
const labels = { 'app.kubernetes.io/name': 'velami-site', 'app.kubernetes.io/part-of': 'velami' };

const walk = (dir, base = '') => readdirSync(dir).flatMap((f) => {
  const rel = base ? `${base}/${f}` : f;
  return statSync(path.join(dir, f)).isDirectory() ? walk(path.join(dir, f), rel) : [rel];
});

const files = walk(SITE).sort();
if (!files.includes('index.en.html')) throw new Error('сначала node site/build.mjs');

const groups = [];
for (const rel of files) {
  const buf = readFileSync(path.join(SITE, rel));
  const text = /\.(html|css|txt|xml|svg)$/.test(rel);
  const size = text ? buf.length : Math.ceil(buf.length / 3) * 4;
  let g = groups.find((x) => x.size + size <= LIMIT);
  if (!g) groups.push(g = { size: 0, data: {}, binaryData: {}, items: [] });
  const key = rel.replace(/\//g, '__');
  if (text) g.data[key] = buf.toString('utf8'); else g.binaryData[key] = buf.toString('base64');
  g.items.push({ key, path: rel });
  g.size += size;
}

const hash = createHash('sha256');
for (const rel of files) hash.update(rel).update(readFileSync(path.join(SITE, rel)));
const conf = { 'default.conf': readFileSync(path.join(ROOT, 'site', 'nginx.conf'), 'utf8'), 'headers.conf': readFileSync(path.join(ROOT, 'site', 'headers.conf'), 'utf8') };
hash.update(conf['default.conf']).update(conf['headers.conf']);
const version = hash.digest('hex').slice(0, 12);

const cm = (name, body) => ({ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name, namespace: NS, labels }, ...body });
const items = [
  { apiVersion: 'v1', kind: 'Namespace', metadata: { name: NS, labels: { ...labels, 'pod-security.kubernetes.io/enforce': 'restricted' } } },
  cm('velami-nginx', { data: conf }),
  ...groups.map((g, i) => cm(`velami-site-${i}`, { data: g.data, binaryData: g.binaryData })),
  {
    apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'velami-site', namespace: NS, labels },
    spec: {
      replicas: 2,
      revisionHistoryLimit: 3,
      selector: { matchLabels: labels },
      strategy: { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } },
      template: {
        metadata: { labels, annotations: { 'velami.pro/content': version } },
        spec: {
          automountServiceAccountToken: false,
          securityContext: { runAsNonRoot: true, runAsUser: 101, runAsGroup: 101, seccompProfile: { type: 'RuntimeDefault' } },
          topologySpreadConstraints: [{ maxSkew: 1, topologyKey: 'kubernetes.io/hostname', whenUnsatisfiable: 'ScheduleAnyway', labelSelector: { matchLabels: labels } }],
          containers: [{
            name: 'nginx',
            image: IMAGE,
            ports: [{ name: 'http', containerPort: 8080 }],
            securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ['ALL'] } },
            resources: { requests: { cpu: '20m', memory: '32Mi' }, limits: { cpu: '100m', memory: '64Mi' } },
            readinessProbe: { httpGet: { path: '/robots.txt', port: 'http' }, periodSeconds: 10 },
            livenessProbe: { httpGet: { path: '/robots.txt', port: 'http' }, periodSeconds: 30 },
            volumeMounts: [
              { name: 'site', mountPath: '/usr/share/nginx/html', readOnly: true },
              { name: 'nginx', mountPath: '/etc/nginx/conf.d/default.conf', subPath: 'default.conf', readOnly: true },
              { name: 'nginx', mountPath: '/etc/nginx/velami/headers.conf', subPath: 'headers.conf', readOnly: true },
              { name: 'tmp', mountPath: '/tmp' },
            ],
          }],
          volumes: [
            { name: 'site', projected: { sources: groups.map((g, i) => ({ configMap: { name: `velami-site-${i}`, items: g.items } })) } },
            { name: 'nginx', configMap: { name: 'velami-nginx' } },
            { name: 'tmp', emptyDir: { sizeLimit: '16Mi' } },
          ],
        },
      },
    },
  },
  { apiVersion: 'policy/v1', kind: 'PodDisruptionBudget', metadata: { name: 'velami-site', namespace: NS, labels }, spec: { minAvailable: 1, selector: { matchLabels: labels } } },
  { apiVersion: 'v1', kind: 'Service', metadata: { name: 'velami-site', namespace: NS, labels }, spec: { selector: labels, ports: [{ name: 'http', port: 80, targetPort: 'http' }] } },
  {
    apiVersion: 'networking.k8s.io/v1', kind: 'Ingress',
    metadata: {
      name: 'velami-site', namespace: NS, labels,
      annotations: { 'cert-manager.io/cluster-issuer': 'letsencrypt-prod', 'nginx.ingress.kubernetes.io/ssl-redirect': 'true' },
    },
    spec: {
      ingressClassName: 'nginx',
      tls: [{ hosts: HOSTS, secretName: 'velami-pro-tls' }],
      rules: HOSTS.map((host) => ({ host, http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: 'velami-site', port: { number: 80 } } } }] } })),
    },
  },
];

const out = path.join(ROOT, 'dist', 'velami-site.k8s.json');
writeFileSync(out, JSON.stringify({ apiVersion: 'v1', kind: 'List', items }, null, 1));
console.log(`${files.length} файлов, ${groups.length} ConfigMap, версия ${version} → ${path.relative(ROOT, out)}`);
if (process.argv.includes('--dry-run')) {
  execFileSync('kubectl', ['apply', '--server-side', '--field-manager=velami-deploy', '--dry-run=server', '-f', out], { stdio: 'inherit' });
} else {
  execFileSync('kubectl', ['apply', '--server-side', '--field-manager=velami-deploy', '-f', out], { stdio: 'inherit' });
  execFileSync('kubectl', ['-n', NS, 'rollout', 'status', 'deploy/velami-site', '--timeout=180s'], { stdio: 'inherit' });
  const live = execFileSync('kubectl', ['-n', NS, 'get', 'configmap', '-l', 'app.kubernetes.io/name=velami-site', '-o', 'name'], { encoding: 'utf8' }).split('\n');
  const stale = live.filter((n) => /^configmap\/velami-site-\d+$/.test(n) && Number(n.split('-').pop()) >= groups.length);
  if (stale.length) execFileSync('kubectl', ['-n', NS, 'delete', ...stale], { stdio: 'inherit' });
}
