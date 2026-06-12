import { Router } from 'express';
import type { JsonStore } from '../lib/storage.js';
import type { AppRelease, EchoApp } from '../types.js';

function compareVersion(a: string, b: string): number { const pa = a.replace(/^v/, '').split(/[.-]/).map((x) => Number.parseInt(x, 10)); const pb = b.replace(/^v/, '').split(/[.-]/).map((x) => Number.parseInt(x, 10)); for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) { const av = Number.isFinite(pa[i]) ? pa[i] : 0; const bv = Number.isFinite(pb[i]) ? pb[i] : 0; if (av !== bv) return av - bv; } return a.localeCompare(b); }
function releasesFor(app: EchoApp, releases: AppRelease[]): AppRelease[] { return releases.filter((rel) => rel.appId === app.id && rel.status === 'published').sort((a, b) => compareVersion(a.version, b.version)); }
function withReleases(apps: EchoApp[], releases: AppRelease[]): Array<EchoApp & { releases: AppRelease[] }> { return apps.map((app) => ({ ...app, releases: releasesFor(app, releases) })); }
function section(id: string, title: string, apps: Array<EchoApp & { releases: AppRelease[] }>) { return { id, title, apps }; }

export function storeRoutes(store: JsonStore): Router {
  const router = Router();
  router.get('/apps', (_req, res) => { const db = store.read(); const apps = withReleases(db.apps.filter((app) => app.visibility === 'published'), db.releases); res.json({ apps }); });
  router.get('/featured', (_req, res) => { const db = store.read(); const apps = withReleases(db.apps.filter((app) => app.visibility === 'published' && app.featured), db.releases); res.json({ apps }); });
  router.get('/categories', (_req, res) => { const db = store.read(); const categories = [...new Set(db.apps.filter((app) => app.visibility === 'published').map((app) => app.category).filter(Boolean))].sort(); res.json({ categories }); });
  router.get('/sections', (_req, res) => { const db = store.read(); const apps = withReleases(db.apps.filter((app) => app.visibility === 'published'), db.releases); const featured = apps.filter((app) => app.featured).slice(0, 8); const recentlyUpdated = [...apps].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).slice(0, 10); const categories = [...new Set(apps.map((app) => app.category).filter(Boolean))].slice(0, 6); const categorySections = categories.map((cat) => section(`cat-${cat.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, `${cat} Apps`, apps.filter((app) => app.category === cat).slice(0, 10))); res.json({ sections: [section('featured', 'Featured & Recommended', featured.length ? featured : apps.slice(0, 8)), section('recent', 'Recently Updated', recentlyUpdated), ...categorySections] }); });
  router.get('/apps/:id', (req, res) => { const db = store.read(); const app = db.apps.find((item) => item.id === req.params.id && item.visibility === 'published'); if (!app) return res.status(404).json({ error: 'App not found.' }); res.json({ app: { ...app, releases: releasesFor(app, db.releases) } }); });
  return router;
}
