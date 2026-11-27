import { contentFields, parseContent, applyContent, pageKey, applyFaq, FAQ_KEY } from './site-content.js?v=03117684';

const home = pageKey(location.pathname) === 'home';
const fields = contentFields(document, home ? '/' : location.pathname, { includeCommon: true });
let requested = false;
function apply(settings) {
  if (requested || !settings) return;
  requested = true;
  const values = parseContent(settings.content?.values);
  const commonValues = parseContent(settings.commonContent?.values);
  const overrides = home ? values : Object.fromEntries(fields.flatMap((field) => {
    const source = field.common ? commonValues : values;
    return Object.hasOwn(source, field.id) ? [[field.id, source[field.id]]] : [];
  }));
  applyContent(fields, overrides);
  if (home && Object.hasOwn(values, FAQ_KEY)) applyFaq(document, values[FAQ_KEY]);
}

document.addEventListener('skinaid:settings', (event) => apply(event.detail));
if (window.SkinAidBackend?.settings) apply(window.SkinAidBackend.settings);
if (!document.querySelector('#bookForm')) {
  const loadContent = () => import('./backend.js?v=0ac8f7bb').catch(() => {});
  if (document.readyState === 'complete') loadContent();
  else window.addEventListener('load', loadContent, { once: true });
}
