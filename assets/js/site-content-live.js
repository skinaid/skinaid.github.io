import { parseContent, renderPublicContent, restoreContent } from './site-content.js?v=544fa061';

const baked = document.querySelector('script[data-content-snapshot]');
const snapshot = baked ? JSON.parse(baked.textContent) : {};
let applied = false;
function apply(settings) {
  if (applied || !settings) return;
  applied = true;
  const raw = (key) => Object.hasOwn(settings, key) ? settings[key]?.values || null : snapshot[key] || null;
  const local = raw('content');
  const common = raw('commonContent');
  if (local === (snapshot.content || null) && common === (snapshot.commonContent || null)) return;
  if (baked) restoreContent(document);
  renderPublicContent(document, document.querySelector('[data-content-path]')?.dataset.contentPath || location.pathname, parseContent(local), parseContent(common));
  document.dispatchEvent(new Event('skinaid:content-applied'));
}

document.addEventListener('skinaid:settings', (event) => apply(event.detail));
if (window.SkinAidBackend?.settings) apply(window.SkinAidBackend.settings);
if (!document.querySelector('#bookForm')) {
  const loadContent = () => import('./backend.js?v=17c2167a').catch(() => {});
  if (document.readyState === 'complete') loadContent();
  else window.addEventListener('load', loadContent, { once: true });
}
