// Эрүүл мэндийн контентод хориотой мэдэгдэл (зар сурталчилгааны эрсдэл, батлагдаагүй амлалт).
// Монгол хэлний нөхцөл залгаварт тохируулсан; зөвхөн эмчилгээний хуудас ба hub-д хэрэглэнэ.
// Хуудас бүр `claimsAllow: ['хамгийн түгээмэл']` гэх мэтээр тодорхой хэллэгийг зөвшөөрч болно
// (энэ жагсаалт reviewHash-д орно — эмч баталсан).

const L = '\\p{L}';
const RULES = [
  ['хамгийн', `(?<!${L})хамгийн(?!${L})`],
  ['шилдэг', `(?<!${L})шилдэг`],
  ['№1 / дугаар нэг', `№\\s*1(?!\\d)|(?<!${L})дугаар\\s+нэг(?!${L})`],
  ['баталгаатай', `(?<!${L})баталгаат`],                       // баталгаажуулна (to confirm) зөвшөөрөгдөнө
  ['100%', `100\\s*(?:%|хувь)`],
  ['баталгаа өгнө', `баталгаа\\s+(?:өг|олго)`],
  ['өвдөлтгүй', `өвдөлтгүй|(?<!${L})өвдөхгүй`],
  ['аюулгүй', `(?<!${L})аюулгүй(?!\\s+байд(?:ал|л[ыаоиу]))`],   // зөвхөн нэр үг «аюулгүй байдал(ын)» зөвшөөрөгдөнө; «аюулгүй байдаг» хориотой
  ['гаж нөлөөгүй', `гаж\\s+нөлөөгүй|гаж\\s+нөлөө\\s+(?:байхгүй|үзүүлэхгүй|гарахгүй|өгөхгүй|огт)`],
  ['бүрмөсөн', `бүрмөсөн`],
  ['үүрд', `(?<!${L})үүрд(?!${L})`],
  ['бүрэн эдгэрнэ/арилна', `бүрэн\\s+(?:эдгэр|арил)`],
  ['гарантитай', `гарант`],
  ['best / guarantee', `(?<![a-z])(?:best|guarantee[ds]?|painless|risk[- ]free|permanent(?:ly)?)(?![a-z])`],
].map(([label, src]) => [label, new RegExp(src, 'giu')]);

/**
 * @param {string} text  markup-гүй текст
 * @param {string[]} allow  зөвшөөрөгдсөн хэллэгүүд (жишээ: 'хамгийн түгээмэл')
 * @returns {{label: string, match: string, context: string}[]}
 */
export function findClaims(text, allow = []) {
  const lower = text.toLowerCase();
  const allowed = [];
  for (const a of allow) {
    const needle = String(a).toLowerCase();
    for (let i = lower.indexOf(needle); i !== -1; i = lower.indexOf(needle, i + 1)) allowed.push([i, i + needle.length]);
  }
  const out = [];
  for (const [label, re] of RULES) {
    re.lastIndex = 0;
    for (const m of lower.matchAll(re)) {
      const s = m.index, e = s + m[0].length;
      if (allowed.some(([a, b]) => s >= a && e <= b)) continue;
      out.push({ label, match: text.slice(s, e), context: text.slice(Math.max(0, s - 30), e + 30).replace(/\s+/g, ' ') });
    }
  }
  return out;
}
