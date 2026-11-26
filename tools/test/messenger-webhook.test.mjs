// Messenger webhook — гарын үсэг, verify, payload задлалт (бодит Meta хэлбэрийн fixture), давхардал, echo,
// зураг/стикер, ярианы төлвийн машин, Graph клиент (mock fetch): node --test 'tools/test/*.test.mjs'
// Эх сурвалж: skinaid/ubbeauty@1a43c95c scripts/test-meta-webhook.mjs (import зам, route/DB-ийн статик тестийг хассан —
// SkinAid-ийн урсгалыг tools/test/messenger-flow.test.mjs шалгана). Meta апп хараахан үүсээгүй — сүлжээ, DB-гүй.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { metaSignature, safeEqual, verifyMetaSignature, verifyWebhookChallenge } from '../../api/_lib/social/meta-signature.js';
import { PAGE_INBOX_APP_ID, parseMessagingItem, parseWebhook, psidHash } from '../../api/_lib/social/meta-events.js';
import {
  AUTOMATION_ECHO_MS,
  classifyEcho,
  echoFingerprint,
  HUMAN_IDLE_HOURS,
  planBatch,
  unansweredUserText,
} from '../../api/_lib/social/conversation-logic.js';
import { redactForLlm } from '../../api/_lib/guardrails.js';
import { classifyMetaError, createMetaClient, GRAPH_BASE, GRAPH_VERSION, MetaApiError, SUBSCRIBED_FIELDS } from '../../api/_lib/social/meta-client.js';

const SECRET = "test-app-secret-not-real-0001";
const PAGE = "104729382716453";
const PSID = "6789012345678901";
const APP = "1122334455667788";
const T = 1764000000000;

// ── Бодит Meta payload-ын хэлбэр (developers.facebook.com/docs/messenger-platform/webhooks) ─────
const fx = {
  text: (mid = "m_AbCdEf123", text = "Сайн байна уу, миний утас 99112233, a@b.mn") => ({
    sender: { id: PSID },
    recipient: { id: PAGE },
    timestamp: T,
    message: { mid, text },
  }),
  image: () => ({
    sender: { id: PSID },
    recipient: { id: PAGE },
    timestamp: T + 1000,
    message: { mid: "m_img1", attachments: [{ type: "image", payload: { url: "https://scontent.xx.fbcdn.net/v/t1.15752-9/secret.jpg" } }] },
  }),
  sticker: () => ({
    sender: { id: PSID },
    recipient: { id: PAGE },
    timestamp: T + 2000,
    message: { mid: "m_st1", sticker_id: 369239263222822, attachments: [{ type: "image", payload: { url: "https://x/like.png", sticker_id: 369239263222822 } }] },
  }),
  echo: (appId = PAGE_INBOX_APP_ID, ts = T + 3000) => ({
    sender: { id: PAGE },
    recipient: { id: PSID },
    timestamp: ts,
    message: { mid: `m_echo${ts}`, is_echo: true, app_id: Number(appId), text: "Сайн байна уу, ажилтан байна" },
  }),
  postback: () => ({
    sender: { id: PSID },
    recipient: { id: PAGE },
    timestamp: T + 4000,
    postback: { mid: "m_pb1", title: "Ажилтантай ярих", payload: "HUMAN" },
  }),
  read: () => ({ sender: { id: PSID }, recipient: { id: PAGE }, timestamp: T, read: { watermark: T } }),
  delivery: () => ({ sender: { id: PSID }, recipient: { id: PAGE }, timestamp: T, delivery: { mids: ["m_x"], watermark: T } }),
  reaction: () => ({ sender: { id: PSID }, recipient: { id: PAGE }, timestamp: T, reaction: { mid: "m_x", action: "react", reaction: "love" } }),
  referral: () => ({ sender: { id: PSID }, recipient: { id: PAGE }, timestamp: T, referral: { ref: "promo_winter", source: "SHORTLINK", type: "OPEN_THREAD" } }),
  take: () => ({ sender: { id: PSID }, recipient: { id: PAGE }, timestamp: T + 5000, take_thread_control: { previous_owner_app_id: APP, metadata: "x" } }),
  // Click-to-Messenger зарын анхны мессеж — referral нь message дотор (ads_context_data-д зураг/URL)
  adMessage: () => ({
    sender: { id: PSID },
    recipient: { id: PAGE },
    timestamp: T,
    message: {
      mid: "m_ad1",
      text: "Энэ урамшууллын талаар дэлгэрэнгүй",
      referral: {
        source: "ADS",
        type: "OPEN_THREAD",
        ref: "winter_promo",
        ad_id: "120212345678901234",
        ads_context_data: { ad_title: "Өвлийн урамшуулал", photo_url: "https://scontent.xx.fbcdn.net/ad.jpg", post_id: "1_2" },
      },
    },
  }),
};
const body = (messaging, extra = {}) => ({ object: "page", entry: [{ id: PAGE, time: T, messaging, ...extra }] });

// ── Гарын үсэг ───────────────────────────────────────────────────────────

test("гарын үсэг: түүхий body-ийн HMAC-SHA256 зөв = true; өөрчилсөн body, буруу нууц, толгойгүй, хэлбэр буруу = false", () => {
  const raw = Buffer.from(JSON.stringify(body([fx.text()])), "utf8");
  const sig = `sha256=${createHmac("sha256", SECRET).update(raw).digest("hex")}`;
  assert.equal(metaSignature(raw, SECRET), sig);
  assert.equal(verifyMetaSignature(raw, sig, SECRET), true);
  assert.equal(verifyMetaSignature(new Uint8Array(raw), sig.toUpperCase().replace("SHA256=", "sha256="), SECRET), true, "hex том үсэг");
  const tampered = Buffer.from(raw.toString().replace("Сайн", "Сайх"), "utf8");
  assert.equal(verifyMetaSignature(tampered, sig, SECRET), false);
  assert.equal(verifyMetaSignature(raw, sig, "өөр-нууц-0000000000"), false);
  assert.equal(verifyMetaSignature(raw, null, SECRET), false);
  assert.equal(verifyMetaSignature(raw, "sha1=abc", SECRET), false);
  assert.equal(verifyMetaSignature(raw, `${sig}00`, SECRET), false);
  assert.equal(verifyMetaSignature(raw, sig, ""), false, "нууцгүй = fail-closed");
  // Дахин сериалчилсан (зай өөрчилсөн) body таарахгүй — заавал ТҮҮХИЙ байтаар
  const reser = Buffer.from(JSON.stringify(JSON.parse(raw.toString()), null, 1), "utf8");
  assert.equal(verifyMetaSignature(reser, sig, SECRET), false);
});

test("GET verify: subscribe + зөв token → challenge; буруу token/mode, token тохируулаагүй, сэжигтэй challenge → null", () => {
  const p = (o) => new URLSearchParams(o);
  assert.equal(verifyWebhookChallenge(p({ "hub.mode": "subscribe", "hub.verify_token": "tok-123456789012", "hub.challenge": "1158201444" }), "tok-123456789012"), "1158201444");
  assert.equal(verifyWebhookChallenge(p({ "hub.mode": "subscribe", "hub.verify_token": "буруу", "hub.challenge": "1" }), "tok-123456789012"), null);
  assert.equal(verifyWebhookChallenge(p({ "hub.mode": "unsubscribe", "hub.verify_token": "tok-123456789012", "hub.challenge": "1" }), "tok-123456789012"), null);
  assert.equal(verifyWebhookChallenge(p({ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "1" }), ""), null);
  assert.equal(verifyWebhookChallenge(p({ "hub.mode": "subscribe", "hub.verify_token": "tok-123456789012", "hub.challenge": "<script>" }), "tok-123456789012"), null);
  assert.equal(safeEqual("a", "a"), true);
  assert.equal(safeEqual("a", "ab"), false);
});

// ── Задлалт ──────────────────────────────────────────────────────────────

test("текст мессеж: утас/имэйл нууцлагдана, PSID payload-д ОРОХГҮЙ, event_key = mid", () => {
  const { events } = parseWebhook(body([fx.text()]));
  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.kind, "message");
  assert.equal(e.mid, "m_AbCdEf123");
  assert.equal(e.eventKey, "m_AbCdEf123");
  assert.equal(e.pageId, PAGE);
  assert.equal(e.eventTime.getTime(), T);
  assert.ok(!e.payload.text.includes("99112233") && !e.payload.text.includes("a@b.mn"));
  assert.match(e.payload.text, /\[утас\]/);
  assert.ok(!JSON.stringify(e.payload).includes(PSID));
});

test("зураг: зөвхөн ТӨРӨЛ, CDN URL хадгалахгүй; стикер = sticker; echo = PSID хүлээн авагчаас, app_id", () => {
  const { events } = parseWebhook(body([fx.image(), fx.sticker(), fx.echo()]));
  const [img, st, echo] = events;
  assert.equal(img.kind, "attachment");
  assert.deepEqual(img.payload.attachments, ["image"]);
  assert.ok(!JSON.stringify(events).includes("fbcdn") && !JSON.stringify(events).includes("http"));
  assert.deepEqual(st.payload.attachments, ["sticker"]);
  assert.equal(echo.kind, "echo");
  assert.equal(echo.psid, PSID, "echo-д хэрэглэгч = recipient");
  assert.equal(echo.payload.app_id, PAGE_INBOX_APP_ID);
});

test("quick reply (user_phone_number / user_email), postback payload дахь утас/имэйл ХАДГАЛАХГҮЙ", () => {
  const { events } = parseWebhook(
    body([
      { ...fx.text("m_qr1", "99112233"), message: { mid: "m_qr1", text: "99112233", quick_reply: { payload: "99112233" } } },
      { ...fx.text("m_qr2", "a@b.mn"), message: { mid: "m_qr2", text: "a@b.mn", quick_reply: { payload: "a@b.mn" } } },
      { ...fx.text("m_qr3", "Цаг захиалах"), message: { mid: "m_qr3", text: "Цаг захиалах", quick_reply: { payload: "QR:Цаг захиалах" } } },
      { sender: { id: PSID }, recipient: { id: PAGE }, timestamp: T, postback: { mid: "m_pb9", title: "Утас", payload: "PHONE_99 11 22 33" } },
    ]),
  );
  const json = JSON.stringify(events);
  assert.ok(!json.includes("99112233") && !json.includes("a@b.mn") && !json.includes("99 11 22 33"));
  assert.equal(events[2].payload.quick_reply, "QR:Цаг захиалах");
  assert.equal(events[3].payload.postback, undefined);
});

test("postback (ice breaker / persistent menu), referral, handover; read/delivery/reaction алгасна", () => {
  const r = parseWebhook(body([fx.postback(), fx.referral(), fx.take(), fx.read(), fx.delivery(), fx.reaction()]));
  assert.deepEqual(r.events.map((e) => e.kind), ["postback", "referral", "handover"]);
  assert.equal(r.skipped, 3);
  const [pb, ref, take] = r.events;
  assert.equal(pb.payload.postback, "HUMAN");
  assert.equal(pb.payload.text, "Ажилтантай ярих");
  assert.deepEqual(ref.payload.referral, { source: "SHORTLINK", ref: "promo_winter" });
  assert.match(ref.eventKey, /^referral:[0-9a-f]{40}$/);
  assert.equal(take.payload.handover, "take");
});

test("зар (click-to-Messenger): referral = эх үүсвэр, ref, зарын id л — зарын зураг/URL хадгалахгүй", () => {
  const { events } = parseWebhook(body([fx.adMessage()]));
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "message");
  assert.deepEqual(events[0].payload.referral, { source: "ADS", ref: "winter_promo", ad_id: "120212345678901234" });
  assert.ok(!JSON.stringify(events).includes("fbcdn") && !JSON.stringify(events).includes("photo_url"));
});

test("standby (Page Inbox эзэмшиж байх үе) тэмдэглэгдэнэ; олон entry, пэйж; page биш object = хоосон; буруу id алгасна", () => {
  const b = {
    object: "page",
    entry: [
      { id: PAGE, time: T, standby: [fx.text("m_sb1", "Сайн уу")] },
      { id: "999999999999", time: T, messaging: [{ ...fx.text("m_p2"), recipient: { id: "999999999999" } }] },
      { id: "bad", time: T, messaging: [fx.text("m_bad")] },
    ],
  };
  const { events } = parseWebhook(b);
  assert.deepEqual(events.map((e) => [e.pageId, e.payload.standby === true]), [[PAGE, true], ["999999999999", false]]);
  assert.deepEqual(parseWebhook({ object: "instagram", entry: [] }).events, []);
  assert.deepEqual(parseWebhook(null).events, []);
  assert.equal(parseMessagingItem({ sender: { id: "abc" }, message: { mid: "m", text: "x" } }, PAGE, false), null);
});

test("давхардал: Meta дахин илгээсэн ижил event = ижил event_key (mid-гүй event-д ч тогтмол hash)", () => {
  const a = parseWebhook(body([fx.text(), fx.referral(), fx.take()])).events.map((e) => e.eventKey);
  const b = parseWebhook(body([fx.text(), fx.referral(), fx.take()])).events.map((e) => e.eventKey);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, 3);
});

test("psidHash: тогтмол, пэйж бүрт өөр, 64 hex, PSID агуулахгүй", () => {
  const h = psidHash(PAGE, PSID, "key-1");
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, psidHash(PAGE, PSID, "key-1"));
  assert.notEqual(h, psidHash("999999999999", PSID, "key-1"));
  assert.notEqual(h, psidHash(PAGE, PSID, "key-2"));
  assert.ok(!h.includes(PSID));
});

// ── Ярианы төлвийн машин ──────────────────────────────────────────────────

const conv0 = { state: "bot", humanSince: null, lastStaffAt: null, lastUserAt: null };
const ev = (id, kind, t, payload = {}) => ({ id, kind, mid: `m_${id}`, eventTime: new Date(t), payload });
const now = new Date(T + 60_000);
const plan = (conv, events, mode = "shadow") => planBatch(conv, events, { mode, ownAppId: APP, now });

test("горим off → бүх event skipped, мессеж хадгалахгүй, агент ажиллахгүй", () => {
  const p = plan(conv0, [ev("a", "message", T, { text: "Сайн уу" })], "off");
  assert.deepEqual(p.eventStatus, { a: "skipped" });
  assert.equal(p.messages.length, 0);
  assert.deepEqual(p.action, { type: "none", reason: "mode_off" });
});

test("текст → НЭГ агентын ажиллагаа (дараалсан мессежүүдэд нэг ноорог); зөвхөн зураг → LLM-гүй загвар", () => {
  const p = plan(conv0, [ev("a", "message", T, { text: "Сайн уу" }), ev("b", "message", T + 1, { text: "Үнэ хэд вэ" })]);
  assert.deepEqual(p.action, { type: "agent", replyToEventId: "b" });
  assert.equal(p.messages.length, 2);
  assert.equal(p.conversation.addedUserMessages, 2);
  const m = plan(conv0, [ev("i", "attachment", T, { attachments: ["image"] })]);
  assert.deepEqual(m.action, { type: "media_template", replyToEventId: "i" });
  // Текст + дараа нь зураг: хариулаагүй хэсэгт текст бий → агент (зургийг LLM-д агуулгагүйгээр тэмдэглэнэ)
  const mix = plan(conv0, [ev("a", "message", T, { text: "Энэ юу вэ" }), ev("i", "attachment", T + 1, { attachments: ["image"] })]);
  assert.equal(mix.action.type, "agent");
});

test("ажилтан (Page Inbox) хариулсан echo → state human, бот чимээгүй; дараагийн мессеж 12 цагийн дотор human_active", () => {
  const p = plan(conv0, [ev("u", "message", T, { text: "Сайн уу" }), ev("e", "echo", T + 60_000, { text: "Сайн байна уу", app_id: PAGE_INBOX_APP_ID })]);
  assert.equal(p.conversation.state, "human");
  assert.deepEqual(p.action, { type: "none", reason: "already_answered" });
  assert.equal(p.messages[1].role, "staff");
  const later = plan(p.conversation, [ev("u2", "message", T + 3600_000, { text: "Баярлалаа" })]);
  assert.deepEqual(later.action, { type: "none", reason: "human_active" });
  const idle = plan(p.conversation, [ev("u3", "message", T + 60_000 + HUMAN_IDLE_HOURS * 3600_000, { text: "Дахиад асууя" })]);
  assert.equal(idle.conversation.state, "bot");
  assert.equal(idle.action.type, "agent");
});

test("манай аппын echo (META_APP_ID) = ботын мессеж, төлөв өөрчлөхгүй; take_thread_control → human; standby → оролцохгүй", () => {
  const own = plan(conv0, [ev("e", "echo", T, { text: "AI хариу", app_id: APP })]);
  assert.equal(own.messages[0].role, "bot");
  assert.equal(own.conversation.state, "bot");
  const take = plan(conv0, [ev("t", "handover", T, { handover: "take" }), ev("u", "message", T + 1, { text: "Сайн уу" })]);
  assert.equal(take.conversation.state, "human");
  assert.deepEqual(take.action, { type: "none", reason: "human_active" });
  // standby (Page Inbox яриаг эзэмшиж байна) — ноорог бичсээр; action.standby = true (outbound.js илгээхгүй)
  const sb = plan(conv0, [ev("s", "message", T, { text: "Сайн уу", standby: true })]);
  assert.deepEqual(sb.action, { type: "agent", replyToEventId: "s", standby: true });
  // standby биш мессежид талбар огт байхгүй
  assert.deepEqual(plan(conv0, [ev("n", "message", T, { text: "Сайн уу" })]).action, { type: "agent", replyToEventId: "n" });
  const ref = plan(conv0, [ev("r", "referral", T, { referral: { source: "SHORTLINK", ref: "x" } })]);
  assert.deepEqual(ref.action, { type: "none", reason: "no_user_message" });
  assert.equal(ref.conversation.referral.ref, "x");
});

// ── Meta-ийн өөрийн автомат хариу (SkinAid-д 12 автоматжуулалт асаалттай, 2026-11-24) ──
// Page Inbox-оос илгээсэн бүх echo (хүн ч, Business Suite-ийн Auto reply/Away/FAQ ч) app_id = 263902037430900 (Meta, v12+)
// тул хугацаагаар ялгана: хэрэглэгчийн мессежээс ≤ 15 сек = автомат.

test("classifyEcho: манай апп = own_bot; хэрэглэгчээс ≤ 15 сек = automation; удаан = ажилтан (ижил Page Inbox app_id)", () => {
  const user = new Date(T);
  const at = (ms) => ({ eventTime: new Date(T + ms), payload: { app_id: PAGE_INBOX_APP_ID } });
  assert.equal(classifyEcho({ eventTime: new Date(T + 1000), payload: { app_id: APP } }, { ownAppId: APP, lastUserAt: user }), "own_bot");
  assert.equal(classifyEcho(at(1500), { ownAppId: APP, lastUserAt: user }), "automation");
  assert.equal(classifyEcho(at(AUTOMATION_ECHO_MS), { ownAppId: APP, lastUserAt: user }), "automation");
  assert.equal(classifyEcho(at(AUTOMATION_ECHO_MS + 1), { ownAppId: APP, lastUserAt: user }), "staff");
  assert.equal(classifyEcho(at(3 * 60_000), { ownAppId: APP, lastUserAt: user }), "staff");
  assert.equal(classifyEcho(at(1000), { ownAppId: APP, lastUserAt: null }), "automation", "хэрэглэгч бичээгүй ярианы echo = Page-ээс эхэлсэн автомат");
  assert.equal(classifyEcho(at(-500), { ownAppId: APP, lastUserAt: user }), "staff");
});

// SkinAid пэйжийн бодит автомат хариу (нийтийн текст, хамтрагч session 2026-11-24): webhook-д нууцлагдсанаар ирнэ
const AUTO_REPLY = redactForLlm("Сайн байна уу ? Бид танд тун удахгүй хариу өгөх болно. Та сонирхсон асуултаа бичиж үлдээнэ үү. Лавлах утас: 7600-0505, баярлалаа");
const HOURS_REPLY = "Өдөр бүр 09:00-19:00 цагийн хооронд ажиллаж байна.";

test("echoFingerprint: нууцалсан текст, зай/цэг/emoji/үсгийн хэмжээ ялгахгүй; богино текст = null", () => {
  assert.match(AUTO_REPLY, /\[утас\]/, "лавлах утас нууцлагдана");
  const h = echoFingerprint(AUTO_REPLY);
  assert.match(h, /^[0-9a-f]{32}$/);
  assert.equal(echoFingerprint(`  ${AUTO_REPLY.toUpperCase()} 🙂 `), h);
  assert.equal(echoFingerprint(AUTO_REPLY.replace(/\s+/g, "  ")), h);
  assert.notEqual(echoFingerprint(HOURS_REPLY), h);
  assert.equal(echoFingerprint("Баярлалаа"), echoFingerprint("баярлалаа!"));
  assert.equal(echoFingerprint("За"), null);
  assert.equal(echoFingerprint(""), null);
});

test("автомат загвар (≥ 3 ярианд ижил текст) = automation — хэрэглэгчээс 15 сек хэтэрсэн ч", () => {
  const hashes = new Set([echoFingerprint(HOURS_REPLY)]);
  const user = new Date(T);
  const late = { eventTime: new Date(T + 10 * 60_000), payload: { text: HOURS_REPLY, app_id: PAGE_INBOX_APP_ID } };
  assert.equal(classifyEcho(late, { ownAppId: APP, lastUserAt: user, automationHashes: hashes }), "automation");
  assert.equal(classifyEcho(late, { ownAppId: APP, lastUserAt: user }), "staff", "загвар таниагүй бол ажилтан");
  const p = plan({ ...conv0, lastUserAt: user }, [ev("h", "echo", T + 10 * 60_000, { text: HOURS_REPLY, app_id: PAGE_INBOX_APP_ID })], "shadow");
  assert.equal(p.messages[0].textHash, echoFingerprint(HOURS_REPLY), "echo-д hash хадгална (загвар тоолоход)");
  const withTpl = planBatch({ ...conv0, lastUserAt: user }, [ev("h", "echo", T + 10 * 60_000, { text: HOURS_REPLY, app_id: PAGE_INBOX_APP_ID })], {
    mode: "shadow",
    ownAppId: APP,
    now,
    automationHashes: hashes,
  });
  assert.equal(withTpl.conversation.state, "bot");
  assert.equal(withTpl.messages[0].role, "automation");
});

test("Comment to message / зарын greeting: Page-ээс эхэлсэн echo (хэрэглэгч бичээгүй) → automation, яриа bot хэвээр", () => {
  const p = plan(conv0, [ev("c2m", "echo", T, { text: "Сэтгэгдэл үлдээсэнд баярлалаа! Дэлгэрэнгүй мэдээллийг энд илгээлээ.", app_id: PAGE_INBOX_APP_ID })]);
  assert.equal(p.messages[0].role, "automation");
  assert.equal(p.conversation.state, "bot");
  // Дараа нь хэрэглэгч хариулбал агент ноорог бичнэ
  const next = plan(p.conversation, [ev("u", "message", T + 3600_000, { text: "Үнэ хэд вэ?" })]);
  assert.equal(next.action.type, "agent");
});

test("Meta автомат хариу: яриаг human болгохгүй, «хариулсан» гэж тооцохгүй — сүүдэр ноорог бичигдсээр", () => {
  const p = plan(conv0, [
    ev("u", "message", T, { text: "Сайн байна уу, ботокс хэд вэ" }),
    ev("auto", "echo", T + 1200, { text: AUTO_REPLY, app_id: PAGE_INBOX_APP_ID }),
  ]);
  assert.equal(p.conversation.state, "bot");
  assert.equal(p.conversation.lastStaffAt, null);
  assert.deepEqual(p.action, { type: "agent", replyToEventId: "u" });
  assert.equal(p.messages[1].role, "automation");
  // Дараа нь ажилтан (5 минутын дараа) хариулбал → human
  const human = plan(p.conversation, [ev("h", "echo", T + 5 * 60_000, { text: "Ботокс 350 мянга", app_id: PAGE_INBOX_APP_ID })]);
  assert.equal(human.conversation.state, "human");
  assert.equal(human.messages[0].role, "staff");
});

test("Meta автомат хариу ӨМНӨХ багцын хэрэглэгчийн мессежид (DB-ийн last_user_at) — тусдаа webhook-оор ирсэн ч automation", () => {
  const conv = { ...conv0, lastUserAt: new Date(T) };
  const p = plan(conv, [ev("auto", "echo", T + 2000, { text: "Автомат", app_id: PAGE_INBOX_APP_ID })]);
  assert.equal(p.conversation.state, "bot");
  assert.equal(p.messages[0].role, "automation");
});

test("зарын referral → ярианд хадгалагдана (хамгийн сүүлийнх)", () => {
  const p = plan(conv0, [ev("a", "message", T, { text: "Сайн уу", referral: { source: "ADS", ref: "winter", ad_id: "120212345678901234" } })]);
  assert.equal(p.conversation.referral.source, "ADS");
  assert.equal(p.conversation.referral.ad_id, "120212345678901234");
  assert.equal(p.conversation.referral.at.getTime(), T);
  assert.equal(plan(conv0, [ev("b", "message", T, { text: "x" })]).conversation.referral, null);
});

test("дараалал алдагдсан багц last_user_at-ийг ухраахгүй", () => {
  const p = plan({ ...conv0, lastUserAt: new Date(T + 3600_000) }, [ev("old", "message", T, { text: "Хуучин мессеж" })]);
  assert.equal(p.conversation.lastUserAt.getTime(), T + 3600_000);
});

test("unansweredUserText: сүүлийн ажилтан/ботын хариунаас хойшхи хэрэглэгчийн текст л", () => {
  assert.equal(
    unansweredUserText([
      { role: "user", text: "Хавдсан" },
      { role: "staff", text: "Эмчид дамжууллаа" },
      { role: "user", text: "Үнэ хэд вэ" },
      { role: "user", text: "" },
      { role: "automation", text: "Бид удахгүй хариулна" },
      { role: "user", text: "Маргааш болох уу" },
    ]),
    "Үнэ хэд вэ\nМаргааш болох уу",
  );
});

// ── Graph клиент (mock fetch) ─────────────────────────────────────────────

function mockFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } });
  };
  return { fn, calls };
}

test("Graph клиент: хувилбар бэхэлсэн (v27.0), token ЗӨВХӨН Authorization толгойд (URL-д үгүй), subscribe талбарууд", async () => {
  const token = "EAAtest-page-token-not-real";
  const m = mockFetch([{ body: { id: PAGE, name: "SkinAid" } }, { body: { success: true } }]);
  const c = createMetaClient({ pageToken: token, fetchImpl: m.fn });
  assert.deepEqual(await c.getPage(PAGE), { id: PAGE, name: "SkinAid" });
  assert.equal(await c.subscribeApp(PAGE), true);
  assert.equal(GRAPH_VERSION, "v27.0");
  assert.equal(m.calls[0].url, `${GRAPH_BASE}/${PAGE}?fields=id,name`);
  assert.ok(m.calls[0].url.startsWith("https://graph.facebook.com/v27.0/"));
  for (const call of m.calls) {
    assert.ok(!call.url.includes(token));
    assert.equal(call.init.headers.Authorization, `Bearer ${token}`);
  }
  assert.deepEqual(JSON.parse(m.calls[1].init.body).subscribed_fields, [...SUBSCRIBED_FIELDS]);
  assert.ok(SUBSCRIBED_FIELDS.includes("message_echoes") && SUBSCRIBED_FIELDS.includes("standby"));
});

test("Graph алдааны ангилал: 190 token, 10/2018300 routing, 551 цонх, 4 хязгаар; сүлжээ; мессежид token үгүй", async () => {
  assert.equal(classifyMetaError(400, { error: { code: 190 } }).kind, "token_invalid");
  assert.equal(classifyMetaError(400, { error: { code: 10, error_subcode: 2018300 } }).kind, "thread_owned");
  assert.equal(classifyMetaError(400, { error: { code: 10, error_subcode: 2018278 } }).kind, "window_closed");
  assert.equal(classifyMetaError(400, { error: { code: 551 } }).kind, "window_closed");
  assert.equal(classifyMetaError(400, { error: { code: 4 } }).kind, "rate_limit");
  assert.equal(classifyMetaError(403, { error: { code: 200 } }).kind, "permission");
  assert.equal(classifyMetaError(400, { error: { code: 100 } }).kind, "invalid");
  const token = "EAAsecret-token-xyz";
  const m = mockFetch([{ status: 400, body: { error: { code: 190, message: `Invalid token ${token}` } } }, new Error("ECONNRESET")]);
  const c = createMetaClient({ pageToken: token, fetchImpl: m.fn });
  await assert.rejects(c.getPage(PAGE), (e) => e instanceof MetaApiError && e.kind === "token_invalid" && !e.message.includes(token));
  await assert.rejects(c.getPage(PAGE), (e) => e instanceof MetaApiError && e.kind === "network");
  await assert.rejects(createMetaClient({ pageToken: "", fetchImpl: m.fn }).getPage(PAGE), (e) => e.kind === "token_invalid");
  await assert.rejects(c.getPage("../me"), (e) => e.kind === "invalid");
});

