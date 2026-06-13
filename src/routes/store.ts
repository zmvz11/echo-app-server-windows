import { Router } from 'express';
import type { JsonStore } from '../lib/storage.js';
import { nowIso } from '../lib/id.js';
import { requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { writeAudit } from '../services/auditLog.js';
import type { AppRelease, EchoApp, StoreLayout, StoreLayoutSection } from '../types.js';

function compareVersion(a: string, b: string): number { const pa = a.replace(/^v/, '').split(/[.-]/).map((x) => Number.parseInt(x, 10)); const pb = b.replace(/^v/, '').split(/[.-]/).map((x) => Number.parseInt(x, 10)); for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) { const av = Number.isFinite(pa[i]) ? pa[i] : 0; const bv = Number.isFinite(pb[i]) ? pb[i] : 0; if (av !== bv) return av - bv; } return a.localeCompare(b); }
function releasesFor(app: EchoApp, releases: AppRelease[]): AppRelease[] { return releases.filter((rel) => rel.appId === app.id && rel.status === 'published').sort((a, b) => compareVersion(a.version, b.version)); }
function withReleases(apps: EchoApp[], releases: AppRelease[]): Array<EchoApp & { releases: AppRelease[] }> { return apps.map((app) => ({ ...app, releases: releasesFor(app, releases) })); }
function section(id: string, title: string, apps: Array<EchoApp & { releases: AppRelease[] }>) { return { id, title, apps }; }
function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section'; }

function defaultLayout(apps: EchoApp[]): StoreLayout {
  const firstCategory = apps.find((app) => app.category)?.category ?? 'Utility';
  return {
    id: 'default-store-layout',
    title: 'Echo Store Layout',
    status: 'published',
    updatedAt: nowIso(),
    sections: [
      { id: 'hero', type: 'hero', title: 'Featured App', enabled: true, source: 'featured', appIds: [], limit: 1 },
      { id: 'featured', type: 'app_row', title: 'Featured & Recommended', enabled: true, source: 'featured', appIds: [], limit: 10 },
      { id: 'recent', type: 'app_row', title: 'Recently Updated', enabled: true, source: 'recently_updated', appIds: [], limit: 10 },
      { id: `cat-${slug(firstCategory)}`, type: 'category_row', title: `${firstCategory} Apps`, enabled: true, source: 'category', category: firstCategory, appIds: [], limit: 10 },
      { id: 'all', type: 'app_grid', title: 'All Echo Apps', enabled: true, source: 'all', appIds: [], limit: 12 },
    ],
  };
}

function normalizeLayout(input: Partial<StoreLayout>, apps: EchoApp[]): StoreLayout {
  const base = defaultLayout(apps);
  const safeSections = Array.isArray(input.sections) ? input.sections.map((section, index): StoreLayoutSection => ({
    id: String(section.id || `section-${index}`),
    type: ['hero','app_row','app_grid','category_row','category_tabs','promo','spacer'].includes(String(section.type)) ? section.type as StoreLayoutSection['type'] : 'app_row',
    title: String(section.title || `Store Section ${index + 1}`).slice(0, 120),
    enabled: section.enabled !== false,
    source: ['manual','featured','recently_updated','category','all'].includes(String(section.source)) ? section.source as StoreLayoutSection['source'] : 'manual',
    appIds: Array.isArray(section.appIds) ? section.appIds.map(String).slice(0, 80) : [],
    category: section.category ? String(section.category).slice(0, 80) : undefined,
    limit: Math.max(1, Math.min(24, Number(section.limit) || 8)),
    note: section.note ? String(section.note).slice(0, 1000) : undefined,
  })) : base.sections;
  return {
    id: String(input.id || 'echo-store-layout'),
    title: String(input.title || 'Echo Store Layout').slice(0, 120),
    status: input.status === 'draft' ? 'draft' : 'published',
    updatedAt: input.updatedAt ? String(input.updatedAt) : nowIso(),
    sections: safeSections,
  };
}

function appsForLayout(section: StoreLayoutSection, apps: Array<EchoApp & { releases: AppRelease[] }>): Array<EchoApp & { releases: AppRelease[] }> {
  let selected: Array<EchoApp & { releases: AppRelease[] }> = [];
  if (section.source === 'manual') selected = section.appIds.map((id) => apps.find((app) => app.id === id)).filter(Boolean) as Array<EchoApp & { releases: AppRelease[] }>;
  if (section.source === 'featured') selected = apps.filter((app) => app.featured);
  if (section.source === 'category') selected = apps.filter((app) => app.category === section.category);
  if (section.source === 'recently_updated') selected = [...apps].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  if (section.source === 'all') selected = [...apps];
  if (section.source !== 'manual' && section.appIds.length) {
    const pinned = section.appIds.map((id) => apps.find((app) => app.id === id)).filter(Boolean) as Array<EchoApp & { releases: AppRelease[] }>;
    selected = [...pinned, ...selected.filter((app) => !section.appIds.includes(app.id))];
  }
  return selected.slice(0, Math.max(1, section.limit || 8));
}

export function storeRoutes(store: JsonStore): Router {
  const router = Router();
  router.get('/apps', (_req, res) => { const db = store.read(); const apps = withReleases(db.apps.filter((app) => app.visibility === 'published'), db.releases); res.json({ apps }); });
  router.get('/featured', (_req, res) => { const db = store.read(); const apps = withReleases(db.apps.filter((app) => app.visibility === 'published' && app.featured), db.releases); res.json({ apps }); });
  router.get('/categories', (_req, res) => { const db = store.read(); const categories = [...new Set(db.apps.filter((app) => app.visibility === 'published').map((app) => app.category).filter(Boolean))].sort(); res.json({ categories }); });
  router.get('/layout', (_req, res) => { const db = store.read(); const apps = db.apps.filter((app) => app.visibility === 'published'); const layout = normalizeLayout(db.storeLayout ?? defaultLayout(apps), apps); res.json({ layout }); });
  router.patch('/admin/layout', ...requirePermission(store, 'apps.edit'), (req: AuthedRequest, res) => {
    const result = store.update((db) => {
      const layout = { ...normalizeLayout(req.body as Partial<StoreLayout>, db.apps), updatedAt: nowIso() };
      db.storeLayout = layout;
      return layout;
    });
    writeAudit(store, { actorUserId: req.user?.id, action: 'admin.store.layout.updated', targetType: 'store_layout', targetId: result.id, details: { status: result.status, sections: result.sections.length } });
    res.json({ layout: result });
  });
  router.get('/sections', (_req, res) => {
    const db = store.read();
    const apps = withReleases(db.apps.filter((app) => app.visibility === 'published'), db.releases);
    const layout = normalizeLayout(db.storeLayout ?? defaultLayout(apps), apps);
    if (layout.status === 'published' && layout.sections.length) {
      const layoutSections = layout.sections.filter((item) => item.enabled && !['hero','category_tabs','promo','spacer'].includes(item.type)).map((item) => section(item.id, item.title, appsForLayout(item, apps)));
      return res.json({ sections: layoutSections });
    }
    const featured = apps.filter((app) => app.featured).slice(0, 8);
    const recentlyUpdated = [...apps].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).slice(0, 10);
    const categories = [...new Set(apps.map((app) => app.category).filter(Boolean))].slice(0, 6);
    const categorySections = categories.map((cat) => section(`cat-${cat.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, `${cat} Apps`, apps.filter((app) => app.category === cat).slice(0, 10)));
    res.json({ sections: [section('featured', 'Featured & Recommended', featured.length ? featured : apps.slice(0, 8)), section('recent', 'Recently Updated', recentlyUpdated), ...categorySections] });
  });
  router.get('/apps/:id', (req, res) => { const db = store.read(); const app = db.apps.find((item) => item.id === req.params.id && item.visibility === 'published'); if (!app) return res.status(404).json({ error: 'App not found.' }); res.json({ app: { ...app, releases: releasesFor(app, db.releases) } }); });
  return router;
}
