/**
 * ربات نور الحدیث - Cloudflare Worker
 * ----------------------------------
 * Binding های مورد نیاز:
 *   1) KV Namespace -> نام باینداینگ: HADITHS  (کلید "data" = آرایه‌ی احادیث)
 *      هر آیتم می‌تواند شامل: text, imam, tags[], book باشد.
 *      مثال: { "text": "...", "imam": "امام علی", "tags": ["عدالت"], "book": "نهج‌البلاغه" }
 *   2) D1 Database -> نام باینداینگ: DB  (برای چالش و لیدربورد - ابتدا schema.sql را در کنسول D1 اجرا کنید)
 *
 * متغیرهای محیطی:
 *   BOT_TOKEN         (Secret)
 *   SUPPORT_USERNAME  (Variable, اختیاری)
 *   BOT_USERNAME      (Variable — یوزرنیم ربات بدون @، برای لینک دعوت دوستان)
 *   ADMIN_ID          (Variable — آیدی عددی تلگرام شما، برای دستور مخفی /admin)
 *
 * Cron Trigger (اختیاری، برای اعلام خودکار بازیکن برتر هر شب):
 *   Settings > Triggers > Cron Triggers > مثلاً: 30 20 * * *  (تقریباً نیمه‌شب تهران)
 */

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('ربات نور الحدیث فعال است ✅');
    }
    try {
      const update = await request.json();
      await handleUpdate(update, env, ctx);
    } catch (err) {
      console.error('Error handling update:', err);
    }
    return new Response('OK');
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(announceDailyTopPlayers(env));
  },
};

async function handleUpdate(update, env, ctx) {
  if (update.message) {
    await handleMessage(update.message, env, ctx);
  } else if (update.callback_query) {
    await handleCallback(update.callback_query, env, ctx);
  }
}

// ---------- Imam directory ----------
const IMAMS = [
  { key: 'muhammad', aliases: ['پیامبر', 'رسول الله', 'محمد', 'حضرت محمد', 'پیامبر اکرم', 'رسول اکرم'], display: 'پیامبر اکرم صلی الله علیه و آله', label: 'پیامبر اکرم' },
  { key: 'fatima', aliases: ['فاطمه', 'حضرت فاطمه', 'زهرا', 'فاطمه زهرا', 'حضرت زهرا'], display: 'حضرت فاطمه زهرا سلام الله علیها', label: 'حضرت فاطمه زهرا' },
  { key: 'ali', aliases: ['علی', 'امام علی', 'حضرت علی'], display: 'امیرالمؤمنین علی علیه‌السلام', label: 'امام علی' },
  { key: 'hassan', aliases: ['حسن', 'امام حسن', 'حضرت حسن', 'امام حسن مجتبی'], display: 'امام حسن مجتبی علیه‌السلام', label: 'امام حسن' },
  { key: 'hussein', aliases: ['حسین', 'امام حسین', 'حضرت حسین', 'سیدالشهدا'], display: 'امام حسین علیه‌السلام', label: 'امام حسین' },
  { key: 'sajjad', aliases: ['سجاد', 'امام سجاد', 'زین العابدین', 'امام زین العابدین'], display: 'امام سجاد علیه‌السلام', label: 'امام سجاد' },
  { key: 'baqir', aliases: ['باقر', 'امام باقر', 'امام محمدباقر'], display: 'امام محمدباقر علیه‌السلام', label: 'امام باقر' },
  { key: 'sadiq', aliases: ['صادق', 'امام صادق', 'امام جعفر صادق'], display: 'امام جعفر صادق علیه‌السلام', label: 'امام صادق' },
  { key: 'kazim', aliases: ['کاظم', 'امام کاظم', 'امام موسی کاظم'], display: 'امام موسی کاظم علیه‌السلام', label: 'امام کاظم' },
  { key: 'reza', aliases: ['رضا', 'امام رضا', 'حضرت رضا', 'امام هشتم'], display: 'امام رضا علیه‌السلام', label: 'امام رضا' },
  { key: 'jawad', aliases: ['جواد', 'امام جواد', 'امام محمدتقی'], display: 'امام محمدتقی علیه‌السلام', label: 'امام جواد' },
  { key: 'hadi', aliases: ['هادی', 'امام هادی', 'امام علی‌النقی', 'امام نقی'], display: 'امام علی‌النقی علیه‌السلام', label: 'امام هادی' },
  { key: 'askari', aliases: ['عسکری', 'امام عسکری', 'امام حسن عسکری'], display: 'امام حسن عسکری علیه‌السلام', label: 'امام حسن عسکری' },
  { key: 'mahdi', aliases: ['مهدی', 'امام مهدی', 'امام زمان', 'حضرت مهدی', 'صاحب الزمان', 'بقیه الله'], display: 'امام زمان عجل الله تعالی فرجه', label: 'امام زمان' },
];

function normalizeFa(str) {
  return (str || '')
    .replace(/[\u200c]/g, ' ')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\s+/g, ' ')
    .trim();
}

function findImamByQuery(query) {
  const q = normalizeFa(query);
  if (!q) return null;
  return IMAMS.find((imam) => imam.aliases.some((a) => normalizeFa(a) === q)) || null;
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ---------- KV: hadiths ----------
async function getHadiths(env) {
  const data = await env.HADITHS.get('data', 'json');
  return Array.isArray(data) ? data : [];
}

function normalizeHadithEntry(raw, index) {
  if (typeof raw === 'string') {
    return { text: raw, imam: null, tags: [], book: null, index };
  }
  return {
    text: raw && raw.text ? raw.text : '',
    imam: raw && raw.imam ? raw.imam : null,
    tags: raw && Array.isArray(raw.tags) ? raw.tags : [],
    book: raw && raw.book ? raw.book : null,
    index,
  };
}

function buildHadithMessage(entry) {
  const imam = entry.imam ? findImamByQuery(entry.imam) : null;
  if (imam) {
    return `${imam.display} فرمودند:\n\n${entry.text}`;
  }
  return entry.text;
}

// ---------- State (فلوهای چندمرحله‌ای: امام / جستجو / هوش مصنوعی) ----------
async function setState(env, chatId, action) {
  await env.HADITHS.put(`state:${chatId}`, action, { expirationTtl: 300 });
}
async function getState(env, chatId) {
  return env.HADITHS.get(`state:${chatId}`);
}
async function clearState(env, chatId) {
  await env.HADITHS.delete(`state:${chatId}`);
}

// ---------- Keyboards ----------
const mainMenuKeyboard = {
  keyboard: [
    [{ text: 'حدیث' }, { text: 'آیه' }],
    [{ text: 'احادیث بر اساس امام' }, { text: 'جستجوی حدیث' }],
    [{ text: 'جستجوی آیه' }],
    [{ text: 'چالش روزانه' }, { text: 'پروفایل' }],
    [{ text: '🎁 شانس' }],
    [{ text: 'علاقه‌مندی‌ها' }, { text: 'دعوت دوستان' }],
    [{ text: 'راهنما' }, { text: 'پشتیبانی' }],
  ],
  resize_keyboard: true,
};

const backKeyboard = {
  keyboard: [[{ text: 'بازگشت' }]],
  resize_keyboard: true,
};

const KNOWN_COMMANDS = new Set([
  '/start', '/help', '/support', '/profile',
  'راهنما', 'پشتیبانی',
  'حدیث',
  'آیه', 'ایه',
  'احادیث بر اساس امام',
  'جستجوی حدیث',
  'جستجوی آیه',
  'چالش روزانه', 'چالش',
  '🎁 شانس', 'صندوق شانس',
  'پروفایل',
  'بازیکن برتر',
  'علاقه‌مندی‌ها',
  'دعوت دوستان',
  '/admin',
  'بازگشت',
]);

function hadithInlineKeyboard(text, isGroup, hadithIndex) {
  const shareUrl = `https://t.me/share/url?url=&text=${encodeURIComponent(text)}`;
  const shareButton = { text: '🔗 اشتراک‌گذاری', url: shareUrl };
  const favButton = { text: '📜 ذخیره', callback_data: `fav:${hadithIndex}` };
  if (isGroup) return { inline_keyboard: [[shareButton], [favButton]] };
  const anotherButton = { text: '🔄 حدیث دیگر', callback_data: `another:${hadithIndex}` };
  return { inline_keyboard: [[shareButton, anotherButton], [favButton]] };
}

// ---------- Message handling ----------
async function handleMessage(message, env, ctx) {
  const chatId = message.chat.id;
  const chatType = message.chat.type;
  const isGroup = chatType === 'group' || chatType === 'supergroup';
  const text = (message.text || '').trim();
  const fromUser = message.from;

  // ضدهرزنامه‌ی ساده: هر کاربر حداکثر هر ۳۰۰ میلی‌ثانیه یک پیام
  if (fromUser) {
    const rlKey = `rl:${fromUser.id}`;
    const lastRaw = await env.HADITHS.get(rlKey);
    const now = Date.now();
    if (lastRaw && now - parseInt(lastRaw, 10) < 300) {
      return;
    }
    await env.HADITHS.put(rlKey, String(now), { expirationTtl: 60 });
  }

  // حذف یک حدیث از علاقه‌مندی‌ها با عدد (مثلاً: حذف 2)
  if (!isGroup && fromUser) {
    const normalized = toEnglishDigits(text).trim();
    const delMatch = normalized.match(/^حذف\s*(\d+)$/);
    if (delMatch) {
      await deleteFavoriteByNumber(env, chatId, fromUser.id, parseInt(delMatch[1], 10));
      return;
    }
  }

  // پردازش لینک دعوت (/start ref_<userId>)
  if (text.startsWith('/start')) {
    const parts = text.split(' ');
    const payload = parts[1];
    if (payload && payload.startsWith('ref_') && !isGroup && fromUser) {
      const referrerId = parseInt(payload.slice(4), 10);
      if (referrerId && referrerId !== fromUser.id) {
        await handleReferral(env, fromUser.id, referrerId);
      }
    }
    if (!isGroup) {
      await sendMessage(env, chatId, 'خوش آمدید به نورالحدیث\n\nاز منوی زیر استفاده کنید.', { reply_markup: mainMenuKeyboard });
    } else {
      await sendMessage(env, chatId, 'سلام 🌹 برای دریافت حدیث بنویسید «حدیث»، برای چالش بنویسید «چالش».');
    }
    return;
  }

  if (!isGroup) {
    const state = await getState(env, chatId);

    if (text === 'بازگشت') {
      await clearState(env, chatId);
      await sendMessage(env, chatId, 'به منوی اصلی بازگشتید.', { reply_markup: mainMenuKeyboard });
      return;
    }

    if (state && !KNOWN_COMMANDS.has(text)) {
      if (state === 'awaiting_imam') {
        await sendHadithByImam(env, chatId, text);
      } else if (state === 'awaiting_search') {
        await sendHadithBySearch(env, chatId, text);
      } else if (state === 'awaiting_ayah_search') {
        await sendAyahBySearch(env, chatId, text);
      }
      await setState(env, chatId, state);
      return;
    }
  }

  if (text === '/help' || text === 'راهنما') {
    await sendHelp(env, chatId);
    return;
  }

  if (text === 'پشتیبانی' || text === '/support') {
    await sendSupport(env, chatId);
    return;
  }

  if (!isGroup && text === 'احادیث بر اساس امام') {
    await setState(env, chatId, 'awaiting_imam');
    await sendMessage(env, chatId, 'نام امام مورد نظر را بنویسید تا حدیثی از ایشان دریافت کنید.', { reply_markup: backKeyboard });
    return;
  }

  if (!isGroup && text === 'جستجوی حدیث') {
    await setState(env, chatId, 'awaiting_search');
    await sendMessage(env, chatId, 'یک موضوع یا کلمه بنویسید تا حدیث مرتبط با آن پیدا شود.', { reply_markup: backKeyboard });
    return;
  }

  if (!isGroup && text === 'جستجوی آیه') {
    await setState(env, chatId, 'awaiting_ayah_search');
    await sendMessage(env, chatId, 'یک موضوع یا کلمه بنویسید تا آیه مرتبط با آن پیدا شود.', { reply_markup: backKeyboard });
    return;
  }

  if ((!isGroup && text === 'چالش روزانه') || (isGroup && text === 'چالش')) {
    await sendChallenge(env, ctx, chatId);
    return;
  }

  if (!isGroup && text === '🎁 شانس') {
    await sendMessage(
      env, chatId,
      '🎁 صندوق شانس\n\nاین صندوق ممکن است به شما امتیاز بدهد، امتیاز از شما کم کند یا پوچ باشد! هر ۱۵ دقیقه یک‌بار می‌توانید امتحان کنید.',
      { reply_markup: { inline_keyboard: [[{ text: '📦 باز کردن صندوق', callback_data: 'luckybox:open' }]] } }
    );
    return;
  }

  if (isGroup && text === 'صندوق شانس') {
    await openLuckyBox(env, chatId, fromUser);
    return;
  }

  // اگه به‌اشتباه یا از قدیم یه کیبورد خصوصی تو گروه گیر کرده باشه، پاکش کن
  if (isGroup && (text === 'بازگشت' || text === 'احادیث بر اساس امام' || text === 'جستجوی حدیث' || text === 'جستجوی آیه' || text === 'چالش روزانه' || text === '🎁 شانس')) {
    await sendMessage(env, chatId, 'این گزینه فقط در چت خصوصی ربات فعال است.', { reply_markup: { remove_keyboard: true } });
    return;
  }

  if (text === 'پروفایل' || text === '/profile') {
    await sendProfile(env, chatId, fromUser);
    return;
  }

  if (text === 'بازیکن برتر') {
    if (isGroup) {
      await sendGroupTopPlayers(env, chatId);
    } else {
      await sendGlobalTopPlayers(env, chatId);
    }
    return;
  }

  if (text === 'علاقه‌مندی‌ها') {
    await sendFavorites(env, chatId, fromUser.id);
    return;
  }

  if (text === 'دعوت دوستان') {
    await sendInviteLink(env, chatId, fromUser);
    return;
  }

  if (text === '/admin') {
    await sendAdminStats(env, chatId, fromUser);
    return;
  }

  if (text === 'حدیث') {
    await sendRandomHadith(env, chatId, isGroup);
    return;
  }

  if (text === 'آیه' || text === 'ایه') {
    await sendRandomAyah(env, chatId, isGroup);
    return;
  }
}

async function getAyat(env) {
  const data = await env.HADITHS.get('ayat', 'json');
  return Array.isArray(data) ? data : [];
}

function normalizeAyahEntry(raw, index) {
  if (typeof raw === 'string') return { text: raw, source: null, surah: null, index };
  return { text: (raw && raw.text) || '', source: (raw && raw.source) || null, surah: (raw && raw.surah) || null, index };
}

function buildAyahMessage(entry) {
  return entry.source ? `${entry.text}\n\n${entry.source}` : entry.text;
}

function ayahInlineKeyboard(text, isGroup, ayahIndex) {
  const shareUrl = `https://t.me/share/url?url=&text=${encodeURIComponent(text)}`;
  const shareButton = { text: '🔗 اشتراک‌گذاری', url: shareUrl };
  const favButton = { text: '📜 ذخیره', callback_data: `favayah:${ayahIndex}` };
  if (isGroup) return { inline_keyboard: [[shareButton], [favButton]] };
  const anotherButton = { text: '🔄 آیه دیگر', callback_data: `anotherayah:${ayahIndex}` };
  return { inline_keyboard: [[shareButton, anotherButton], [favButton]] };
}

async function sendRandomAyah(env, chatId, isGroup, excludeIndex = -1) {
  const raw = await getAyat(env);
  if (raw.length === 0) {
    await sendMessage(env, chatId, 'در حال حاضر آیه‌ای در دیتابیس ثبت نشده است.');
    return;
  }
  let idx;
  if (raw.length === 1) idx = 0;
  else {
    do { idx = Math.floor(Math.random() * raw.length); } while (idx === excludeIndex);
  }
  const entry = normalizeAyahEntry(raw[idx], idx);
  await sendMessage(env, chatId, buildAyahMessage(entry), {
    reply_markup: ayahInlineKeyboard(entry.text, isGroup, entry.index),
  });
}

async function sendRandomHadith(env, chatId, isGroup, excludeIndex = -1) {
  const raw = await getHadiths(env);
  if (raw.length === 0) {
    await sendMessage(env, chatId, 'در حال حاضر حدیثی در دیتابیس ثبت نشده است.');
    return;
  }
  let idx;
  if (raw.length === 1) idx = 0;
  else {
    do { idx = Math.floor(Math.random() * raw.length); } while (idx === excludeIndex);
  }
  const entry = normalizeHadithEntry(raw[idx], idx);
  await sendMessage(env, chatId, buildHadithMessage(entry), {
    reply_markup: hadithInlineKeyboard(entry.text, isGroup, entry.index),
  });
}

async function sendHadithByImam(env, chatId, queryText) {
  const imam = findImamByQuery(queryText);
  if (!imam) {
    await sendMessage(env, chatId, 'امام موردنظر شناسایی نشد. لطفاً نام را دقیق‌تر بنویسید؛ مثلاً: امام رضا.');
    return;
  }
  const raw = await getHadiths(env);
  const matches = raw.map((r, i) => normalizeHadithEntry(r, i)).filter((e) => {
    const found = e.imam ? findImamByQuery(e.imam) : null;
    return found && found.key === imam.key;
  });
  if (matches.length === 0) {
    await sendMessage(env, chatId, `فعلاً حدیثی از ${imam.display} ثبت نشده است.`);
    return;
  }
  const picked = pickRandom(matches);
  await sendMessage(env, chatId, buildHadithMessage(picked), {
    reply_markup: hadithInlineKeyboard(picked.text, false, picked.index),
  });
}

async function sendHadithBySearch(env, chatId, keyword) {
  const q = normalizeFa(keyword);
  if (!q) {
    await sendMessage(env, chatId, 'لطفاً یک کلمه یا موضوع معتبر بنویسید.');
    return;
  }
  const raw = await getHadiths(env);
  const matches = raw.map((r, i) => normalizeHadithEntry(r, i)).filter((e) => {
    const inText = normalizeFa(e.text).includes(q);
    const inTags = (e.tags || []).some((t) => normalizeFa(t).includes(q));
    return inText || inTags;
  });
  if (matches.length === 0) {
    await sendMessage(env, chatId, `حدیثی درباره‌ی «${keyword}» پیدا نشد.`);
    return;
  }
  const picked = pickRandom(matches);
  await sendMessage(env, chatId, buildHadithMessage(picked), {
    reply_markup: hadithInlineKeyboard(picked.text, false, picked.index),
  });
}

async function sendAyahBySearch(env, chatId, keyword) {
  const q = normalizeFa(keyword);
  if (!q) {
    await sendMessage(env, chatId, 'لطفاً یک کلمه یا موضوع معتبر بنویسید.');
    return;
  }
  const raw = await getAyat(env);
  const matches = raw.map((r, i) => normalizeAyahEntry(r, i)).filter((e) => {
    const inText = normalizeFa(e.text).includes(q);
    const inSurah = e.surah && normalizeFa(e.surah).includes(q);
    return inText || inSurah;
  });
  if (matches.length === 0) {
    await sendMessage(env, chatId, `آیه‌ای درباره‌ی «${keyword}» پیدا نشد.`);
    return;
  }
  const picked = pickRandom(matches);
  await sendMessage(env, chatId, buildAyahMessage(picked), {
    reply_markup: ayahInlineKeyboard(picked.text, false, picked.index),
  });
}

// ---------- علاقه‌مندی‌ها ----------
async function addFavorite(env, userId, entry) {
  const key = `fav:${userId}`;
  let list = await env.HADITHS.get(key, 'json');
  if (!Array.isArray(list)) list = [];
  if (list.some((f) => f.text === entry.text)) return false;
  list.unshift({ text: entry.text, imam: entry.imam });
  if (list.length > 50) list = list.slice(0, 50);
  await env.HADITHS.put(key, JSON.stringify(list));
  return true;
}

async function sendFavorites(env, chatId, userId) {
  const list = (await env.HADITHS.get(`fav:${userId}`, 'json')) || [];
  if (list.length === 0) {
    await sendMessage(env, chatId, '📜 هنوز حدیثی ذخیره نکرده‌اید.\n\nزیر هر حدیث دکمه‌ی «📜 ذخیره» را بزنید تا اینجا نگهش داریم.');
    return;
  }

  const intro = `📜 حدیث‌های ذخیره‌شده‌ی شما (${list.length} مورد):\n\n`;
  const chunks = [];
  let current = intro;
  list.forEach((item, i) => {
    const entryText = `${i + 1}. ${buildHadithMessage(item)}\n🗑 برای حذف این مورد بنویسید: حذف ${i + 1}\n\n`;
    if ((current + entryText).length > 3500) {
      chunks.push(current);
      current = entryText;
    } else {
      current += entryText;
    }
  });
  chunks.push(current);

  for (const chunk of chunks) {
    await sendMessage(env, chatId, chunk);
  }
}

function toEnglishDigits(str) {
  const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
  return (str || '').replace(/[۰-۹]/g, (d) => String(persianDigits.indexOf(d)));
}

async function deleteFavoriteByNumber(env, chatId, userId, number) {
  const key = `fav:${userId}`;
  let list = await env.HADITHS.get(key, 'json');
  if (!Array.isArray(list) || number < 1 || number > list.length) {
    await sendMessage(env, chatId, 'شماره‌ی وارد شده معتبر نیست.');
    return;
  }
  list.splice(number - 1, 1);
  await env.HADITHS.put(key, JSON.stringify(list));
  await sendMessage(env, chatId, `🗑 حدیث شماره‌ی ${number} از علاقه‌مندی‌ها حذف شد.`);
}

// ---------- دعوت دوستان ----------
async function handleReferral(env, newUserId, referrerId) {
  if (!env.DB) return;
  const existing = await env.DB.prepare('SELECT 1 FROM referrals WHERE referred_user_id = ?').bind(newUserId).first();
  if (existing) return;
  await env.DB.prepare('INSERT INTO referrals (referred_user_id, referrer_id, created_at) VALUES (?, ?, ?)')
    .bind(newUserId, referrerId, new Date().toISOString()).run();

  const bonus = 15;
  await env.DB.prepare(
    `INSERT INTO users (user_id, username, first_name, total_score, correct_count, wrong_count, referral_count)
     VALUES (?, NULL, '', ?, 0, 0, 1)
     ON CONFLICT(user_id) DO UPDATE SET total_score = total_score + excluded.total_score, referral_count = referral_count + 1`
  ).bind(referrerId, bonus).run();

  try {
    const row = await env.DB.prepare('SELECT referral_count, first_name, username FROM users WHERE user_id = ?').bind(referrerId).first();
    let titleNote = '';
    if (row && row.referral_count >= 10) {
      const added = await unlockTitle(env, referrerId, 'inviter10');
      if (added.length > 0) {
        const name = row.first_name || row.username || 'کاربر';
        titleNote = `\n\n🎉 عنوان جدید برای ${name}!\n${added.map((c) => `🎖️ ${titleLabel(c)}`).join('\n')}`;
      }
    }
    await sendMessage(env, referrerId, `🎉 یک نفر با لینک دعوت شما به نورالحدیث پیوست!\n\n۱۵ امتیاز جایزه گرفتید ✨${titleNote}`);
  } catch (err) {
    console.error('referral notify error:', err);
  }
}

async function sendInviteLink(env, chatId, user) {
  if (!env.BOT_USERNAME) {
    await sendMessage(env, chatId, 'این قابلیت هنوز فعال نشده (نیاز به تنظیم متغیر BOT_USERNAME است).');
    return;
  }
  const link = `https://t.me/${env.BOT_USERNAME}?start=ref_${user.id}`;
  let countLine = '';
  if (env.DB) {
    const row = await env.DB.prepare('SELECT referral_count FROM users WHERE user_id = ?').bind(user.id).first();
    countLine = `\n\n👥 تعداد دعوت‌های موفق شما: ${(row && row.referral_count) || 0}`;
  }
  await sendMessage(env, chatId, `🔗 لینک دعوت اختصاصی شما:\n${link}\n\nهر کس با این لینک وارد ربات شود، ۱۵ امتیاز جایزه می‌گیرید.${countLine}`);
}

// ---------- پنل مدیریت (فقط برای مالک ربات) ----------
async function sendAdminStats(env, chatId, fromUser) {
  if (!env.ADMIN_ID || !fromUser || String(fromUser.id) !== String(env.ADMIN_ID)) return;
  if (!env.DB) {
    await sendMessage(env, chatId, 'دیتابیس D1 هنوز متصل نشده.');
    return;
  }
  const totalUsers = await env.DB.prepare('SELECT COUNT(*) as c FROM users').first();
  const totalScore = await env.DB.prepare('SELECT SUM(total_score) as s FROM users').first();
  const totalCorrect = await env.DB.prepare('SELECT SUM(correct_count) as c FROM users').first();
  const totalWrong = await env.DB.prepare('SELECT SUM(wrong_count) as c FROM users').first();
  const totalReferrals = await env.DB.prepare('SELECT COUNT(*) as c FROM referrals').first();
  const text = `📊 آمار مدیریتی نورالحدیث
━━━━━━━━━━━━━━━━━
کاربران ثبت‌شده: ${totalUsers.c || 0}
مجموع امتیازها: ${totalScore.s || 0}
پاسخ‌های درست: ${totalCorrect.c || 0}
پاسخ‌های غلط: ${totalWrong.c || 0}
دعوت‌های موفق: ${totalReferrals.c || 0}`;
  await sendMessage(env, chatId, text);
}

async function updateStreak(env, userId) {
  const today = todayStr();
  const row = await env.DB.prepare('SELECT current_streak, last_played_date, days_active FROM users WHERE user_id = ?').bind(userId).first();
  if (row && row.last_played_date === today) return row.current_streak || 0;

  let newStreak = 1;
  if (row && row.last_played_date) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    newStreak = row.last_played_date === yesterday ? (row.current_streak || 0) + 1 : 1;
  }
  const newDaysActive = ((row && row.days_active) || 0) + 1;
  await env.DB.prepare('UPDATE users SET current_streak = ?, last_played_date = ?, days_active = ? WHERE user_id = ?')
    .bind(newStreak, today, newDaysActive, userId).run();
  return newStreak;
}

// ---------- عنوان‌های ویژه ----------
const TITLES = [
  { code: 'combo10', emoji: '⚔', name: 'شکارچی کمبو', desc: 'رسیدن به کمبو ۱۰ پاسخ صحیح پشت سر هم.' },
  { code: 'flawless20', emoji: '🎯', name: 'بی‌خطا', desc: 'پاسخ صحیح به ۲۰ سؤال بدون حتی یک اشتباه.' },
  { code: 'speed5', emoji: '⚡', name: 'برق‌آسا', desc: 'پاسخ صحیح به یک چالش در کمتر از ۵ ثانیه.' },
  { code: 'inviter10', emoji: '👥', name: 'دعوت‌گر', desc: 'دعوت موفق ۱۰ نفر به ربات.' },
  { code: 'loyal50', emoji: '⚜️', name: 'وفادار', desc: 'حضور فعال به مدت ۵۰ روز.' },
];
const LEGEND_TITLE = { code: 'legend', emoji: '💎', name: 'افسانه', desc: 'کسب تمام عنوان‌های موجود.' };
const ALL_TITLES = [...TITLES, LEGEND_TITLE];

function titleLabel(code) {
  const t = ALL_TITLES.find((x) => x.code === code);
  return t ? `${t.emoji} ${t.name}` : code;
}

async function unlockTitle(env, userId, code) {
  const row = await env.DB.prepare('SELECT titles FROM users WHERE user_id = ?').bind(userId).first();
  const list = row && row.titles ? row.titles.split(',').filter(Boolean) : [];
  const added = [];
  if (!list.includes(code)) {
    list.push(code);
    added.push(code);
  }
  const hasAll = TITLES.every((t) => list.includes(t.code));
  if (hasAll && !list.includes('legend')) {
    list.push('legend');
    added.push('legend');
  }
  if (added.length > 0) {
    await env.DB.prepare('UPDATE users SET titles = ? WHERE user_id = ?').bind(list.join(','), userId).run();
  }
  return added;
}

async function announceNewTitles(env, chatId, name, codes) {
  if (!codes || codes.length === 0) return;
  const lines = codes.map((c) => `🎖️ ${titleLabel(c)}`).join('\n');
  await sendMessage(env, chatId, `🎉 عنوان جدید برای ${escapeHtml(name)}!\n\n${lines}`, { parse_mode: 'HTML' });
}

// ---------- چالش روزانه ----------
async function getFillBlanks(env) {
  const data = await env.HADITHS.get('fillblanks', 'json');
  return Array.isArray(data) ? data : [];
}

async function buildChallengeQuestion(env) {
  const raw = await getHadiths(env);
  const all = raw.map((r, i) => normalizeHadithEntry(r, i));
  const eligible = all.filter((e) => e.imam || (e.tags && e.tags.length) || e.book);
  const fillBlanks = await getFillBlanks(env);
  const rawAyat = await getAyat(env);
  const allAyat = rawAyat.map((r, i) => normalizeAyahEntry(r, i));
  const eligibleAyat = allAyat.filter((e) => e.surah);

  const sources = [];
  if (eligible.length > 0) sources.push('hadith');
  if (fillBlanks.length > 0) sources.push('fillblank');
  if (eligibleAyat.length > 0) sources.push('ayah');
  if (sources.length === 0) return null;
  const source = pickRandom(sources);

  if (source === 'fillblank') {
    const item = pickRandom(fillBlanks);
    if (!item || !item.text || !Array.isArray(item.options) || !item.correct) return null;
    const options = shuffle(item.options);
    return { entry: { text: item.text }, question: 'جای خالی را با کدام گزینه پر می‌کنید؟', options, correctAnswer: item.correct };
  }

  if (source === 'ayah') {
    const ayahEntry = pickRandom(eligibleAyat);
    const correctAnswer = ayahEntry.surah;
    const poolAll = Array.from(new Set(allAyat.map((e) => e.surah).filter(Boolean)));
    const distractorsPool = shuffle(poolAll.filter((x) => x && x !== correctAnswer));
    const distractors = distractorsPool.slice(0, 3);
    if (distractors.length < 1) return null;
    const options = shuffle([correctAnswer, ...distractors]);
    return { entry: { text: ayahEntry.text }, question: 'این آیه از کدام سوره است؟', options, correctAnswer };
  }

  const entry = pickRandom(eligible);
  const types = [];
  if (entry.imam) types.push('imam');
  if (entry.tags && entry.tags.length) types.push('topic');
  if (entry.book) types.push('book');
  const type = pickRandom(types);

  let correctAnswer, poolAll, question;
  if (type === 'imam') {
    const imamObj = findImamByQuery(entry.imam);
    correctAnswer = imamObj ? imamObj.label : entry.imam;
    poolAll = IMAMS.map((i) => i.label);
    question = 'این حدیث از کدام امام است؟';
  } else if (type === 'topic') {
    correctAnswer = entry.tags[0];
    poolAll = Array.from(new Set(all.flatMap((e) => e.tags || [])));
    question = 'موضوع این حدیث چیست؟';
  } else {
    correctAnswer = entry.book;
    poolAll = Array.from(new Set(all.map((e) => e.book).filter(Boolean)));
    question = 'این حدیث از کدام کتاب است؟';
  }

  const distractorsPool = shuffle(poolAll.filter((x) => x && x !== correctAnswer));
  const distractors = distractorsPool.slice(0, 3);
  if (distractors.length < 1) return null; // برای سؤال معتبر حداقل یک گزینه‌ی غلط لازم است
  const options = shuffle([correctAnswer, ...distractors]);
  return { entry, question, options, correctAnswer };
}

async function sendChallenge(env, ctx, chatId) {
  const q = await buildChallengeQuestion(env);
  if (!q) {
    await sendMessage(env, chatId, 'برای چالش نیاز به احادیثی با اطلاعات امام/موضوع/کتاب هست که فعلاً کافی نیست.');
    return;
  }
  const challengeId = `${chatId}:${Date.now()}`;
  const startTime = Date.now();
  const deadline = startTime + 30000;
  const payload = { correctAnswer: q.correctAnswer, options: q.options, resolved: false, startTime, deadline, chatId };
  await env.HADITHS.put(`challenge:${challengeId}`, JSON.stringify(payload), { expirationTtl: 120 });

  const keyboard = { inline_keyboard: q.options.map((opt, i) => [{ text: opt, callback_data: `chal:${challengeId}:${i}` }]) };
  const msgText = `⏳ چالش حدیث (۳۰ ثانیه فرصت دارید)\n\n${q.entry.text}\n\n❓ ${q.question}`;
  const sent = await sendMessage(env, chatId, msgText, { reply_markup: keyboard });
  const messageId = sent && sent.result ? sent.result.message_id : null;

  if (messageId && ctx) {
    ctx.waitUntil(revealAfterDelay(env, challengeId, chatId, messageId, q));
  }
}

async function revealAfterDelay(env, challengeId, chatId, messageId, q) {
  await new Promise((res) => setTimeout(res, 30000));
  const raw = await env.HADITHS.get(`challenge:${challengeId}`);
  if (!raw) return;
  const state = JSON.parse(raw);
  if (state.resolved) return;
  await env.HADITHS.delete(`challenge:${challengeId}`);
  await editMessageText(env, chatId, messageId, `⏰ زمان تمام شد!\n\nپاسخ درست: ${q.correctAnswer}\n\n${buildHadithMessage(q.entry)}`);
}

function getRankTitle(score) {
  if (score >= 10000) return 'نورالحدیث 🤹';
  if (score >= 5000) return 'بحرالحدیث 🏵️';
  if (score >= 3000) return 'محدث 🪄';
  if (score >= 1800) return 'حکیم 🪎';
  if (score >= 1000) return 'استاد حدیث 🔮';
  if (score >= 600) return 'حافظ 📓';
  if (score >= 300) return 'حدیث‌پژوه 🧪';
  return 'تازه‌وارد ✏️';
}

// ---------- صندوق شانس ----------
function pickLuckyOutcome() {
  const outcomes = [
    { delta: 50, weight: 2, message: '🎉 شانس آوردی! +۵۰ امتیاز گرفتی.' },
    { delta: 80, weight: 1, message: '🌟 شانس بزرگ! +۸۰ امتیاز گرفتی.' },
    { delta: 30, weight: 3, message: '✨ +۳۰ امتیاز گرفتی.' },
    { delta: -15, weight: 2, message: '😅 بدشانسی! ۱۵ امتیاز از دست دادی.' },
    { delta: 0, weight: 2, message: '📦 پوچ! این بار چیزی نگرفتی.' },
  ];
  const total = outcomes.reduce((s, o) => s + o.weight, 0);
  let r = Math.random() * total;
  for (const o of outcomes) {
    if (r < o.weight) return o;
    r -= o.weight;
  }
  return outcomes[outcomes.length - 1];
}

async function adjustUserScore(env, user, delta) {
  await env.DB.prepare(
    `INSERT INTO users (user_id, username, first_name, total_score, correct_count, wrong_count)
     VALUES (?, ?, ?, ?, 0, 0)
     ON CONFLICT(user_id) DO UPDATE SET
       username = excluded.username,
       first_name = excluded.first_name,
       total_score = total_score + excluded.total_score`
  ).bind(user.id, user.username || null, user.first_name || '', delta).run();
}

async function openLuckyBox(env, chatId, user) {
  if (!env.DB) {
    await sendMessage(env, chatId, 'این قابلیت نیاز به دیتابیس D1 دارد.');
    return;
  }
  const cooldownKey = `luckybox:${user.id}`;
  const last = await env.HADITHS.get(cooldownKey);
  if (last) {
    const remainingMs = 900000 - (Date.now() - parseInt(last, 10));
    if (remainingMs > 0) {
      const minutes = Math.ceil(remainingMs / 60000);
      await sendMessage(env, chatId, `⏳ صندوق شانس شما هنوز آماده نیست. حدود ${minutes} دقیقه‌ی دیگر دوباره امتحان کنید.`);
      return;
    }
  }
  await env.HADITHS.put(cooldownKey, String(Date.now()), { expirationTtl: 900 });

  const outcome = pickLuckyOutcome();
  try {
    await adjustUserScore(env, user, outcome.delta);
  } catch (err) {
    console.error('lucky box score error:', err);
  }
  const name = user.first_name || user.username || 'کاربر';
  await sendMessage(env, chatId, `🎁 ${escapeHtml(name)} صندوق شانس را باز کرد!\n\n${outcome.message}`, { parse_mode: 'HTML' });
}

async function upsertUserAnswer(env, user, isCorrect, points) {
  await env.DB.prepare(
    `INSERT INTO users (user_id, username, first_name, total_score, correct_count, wrong_count)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       username=excluded.username,
       first_name=excluded.first_name,
       total_score = total_score + excluded.total_score,
       correct_count = correct_count + excluded.correct_count,
       wrong_count = wrong_count + excluded.wrong_count`
  ).bind(user.id, user.username || null, user.first_name || '', points, isCorrect ? 1 : 0, isCorrect ? 0 : 1).run();
}

async function upsertGroupScore(env, userId, chatId, points, isCorrect) {
  await env.DB.prepare(
    `INSERT INTO group_scores (user_id, chat_id, score, correct_count, wrong_count) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, chat_id) DO UPDATE SET
       score = score + excluded.score,
       correct_count = correct_count + excluded.correct_count,
       wrong_count = wrong_count + excluded.wrong_count`
  ).bind(userId, chatId, points, isCorrect ? 1 : 0, isCorrect ? 0 : 1).run();
}

async function upsertDailyScore(env, userId, chatId, dateStr, points) {
  if (points === 0) return;
  await env.DB.prepare(
    `INSERT INTO daily_scores (user_id, chat_id, date, score) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, chat_id, date) DO UPDATE SET score = score + excluded.score`
  ).bind(userId, chatId, dateStr, points).run();
}

async function sendProfile(env, chatId, user) {
  const row = await env.DB.prepare('SELECT total_score, correct_count, wrong_count, current_streak, referral_count, titles FROM users WHERE user_id = ?').bind(user.id).first();
  const score = row ? row.total_score : 0;
  const correct = row ? row.correct_count : 0;
  const wrong = row ? row.wrong_count : 0;
  const rank = getRankTitle(score);
  let text = `👤 پروفایل شما\n━━━━━━━━━━━━━━━━━\nامتیاز کل: ${score}\nرتبه: ${rank}\nپاسخ‌های درست: ${correct}\nپاسخ‌های اشتباه: ${wrong}`;
  if (row && row.current_streak >= 2) text += `\n🔥 ${row.current_streak} روز متوالی در چالش`;
  if (row && row.referral_count > 0) text += `\n👥 ${row.referral_count} دعوت موفق`;
  const titleCodes = row && row.titles ? row.titles.split(',').filter(Boolean) : [];
  if (titleCodes.length > 0) {
    text += `\n\n🏅 عنوان‌های کسب‌شده: ${titleCodes.length}\n${titleCodes.map(titleLabel).join('، ')}`;
  }
  await sendMessage(env, chatId, text, {
    reply_markup: { inline_keyboard: [[{ text: '🏆 بازیکن برتر', callback_data: 'top_player' }]] },
  });
}

function formatPlayerCard(userId, rawName, medal, row) {
  const rank = getRankTitle(row.total_score);
  const nameLine = `${medal ? medal + ' ' : ''}<a href="tg://user?id=${userId}">${escapeHtml(rawName)}</a>`;
  let text = `${nameLine}\n━━━━━━━━━━━━━━━━━\nامتیاز کل: ${row.total_score}\nرتبه: ${rank}\nپاسخ‌های درست: ${row.correct_count}\nپاسخ‌های اشتباه: ${row.wrong_count}`;
  if (row.current_streak >= 2) text += `\n🔥 ${row.current_streak} روز متوالی در چالش`;
  if (row.referral_count > 0) text += `\n👥 ${row.referral_count} دعوت موفق`;
  return text;
}

async function sendGroupTopPlayers(env, chatId) {
  const rows = await env.DB.prepare('SELECT user_id, score, correct_count, wrong_count FROM group_scores WHERE chat_id = ? ORDER BY score DESC LIMIT 3').bind(chatId).all();
  if (!rows.results || rows.results.length === 0) {
    await sendMessage(env, chatId, 'هنوز امتیازی در این گروه ثبت نشده.');
    return;
  }
  const medals = ['🥇', '🥈', '🥉'];
  const cards = [];
  for (let i = 0; i < rows.results.length; i++) {
    const r = rows.results[i];
    const u = await env.DB.prepare('SELECT username, first_name, total_score, current_streak, referral_count FROM users WHERE user_id = ?').bind(r.user_id).first();
    if (!u) continue;
    const name = u.first_name || u.username || 'کاربر';
    const mergedRow = {
      total_score: u.total_score,
      correct_count: r.correct_count,
      wrong_count: r.wrong_count,
      current_streak: u.current_streak,
      referral_count: u.referral_count,
    };
    cards.push(formatPlayerCard(r.user_id, name, medals[i], mergedRow));
  }
  await sendMessage(env, chatId, `🏆 برترین بازیکنان این گروه:\n\n${cards.join('\n\n')}`, { parse_mode: 'HTML' });
}

async function sendGlobalTopPlayers(env, chatId) {
  const rows = await env.DB.prepare('SELECT user_id, username, first_name, total_score, correct_count, wrong_count, current_streak, referral_count FROM users ORDER BY total_score DESC LIMIT 3').all();
  if (!rows.results || rows.results.length === 0) {
    await sendMessage(env, chatId, 'هنوز کسی امتیاز نگرفته.');
    return;
  }
  const medals = ['🥇', '🥈', '🥉'];
  const cards = rows.results.map((r, i) => {
    const name = r.first_name || r.username || 'کاربر';
    return formatPlayerCard(r.user_id, name, medals[i], r);
  });
  await sendMessage(env, chatId, `🏆 برترین بازیکنان ربات:\n\n${cards.join('\n\n')}`, { parse_mode: 'HTML' });
}

async function announceDailyTopPlayers(env) {
  const date = todayStr();
  const rows = await env.DB.prepare('SELECT DISTINCT chat_id FROM daily_scores WHERE date = ?').bind(date).all();
  for (const row of (rows.results || [])) {
    const top = await env.DB.prepare('SELECT user_id, score FROM daily_scores WHERE chat_id = ? AND date = ? ORDER BY score DESC LIMIT 1').bind(row.chat_id, date).first();
    if (!top) continue;
    const u = await env.DB.prepare('SELECT username, first_name FROM users WHERE user_id = ?').bind(top.user_id).first();
    const name = (u && (u.first_name || u.username)) || 'کاربر';
    await sendMessage(env, row.chat_id, `🌙 بازیکن برتر امروز:\n\n<a href="tg://user?id=${top.user_id}">${escapeHtml(name)}</a> با ${top.score} امتیاز 🎉`, { parse_mode: 'HTML' });
  }
}

async function sendHelp(env, chatId) {
  const helpText = `• گزینه «احادیث بر اساس امام»
نام امام مورد نظر را بنویسید تا حدیثی از ایشان دریافت کنید.

• گزینه «جستجوی حدیث»
یک موضوع یا کلمه بنویسید تا حدیث مرتبط با آن پیدا شود.

• گزینه چالش روزانه :
یک حدیث یا سؤال نمایش داده می‌شود و باید در ۳۰ ثانیه پاسخ دهید. پاسخ درست ۱۰ امتیاز، پاسخ اشتباه ۵- امتیاز دارد و رتبه‌تان بر اساس امتیاز کل بالا یا پایین می‌رود.
رتبه‌ها : تازه‌وارد ✏️ ← حدیث‌پژوه 🧪 ← حافظ 📓 ← استاد حدیث 🔮 ← حکیم 🪎 ← محدث 🪄 ← بحرالحدیث 🏵️ ← نورالحدیث 🤹

• گروه‌ها :
بنویسید «حدیث» تا حدیث ارسال شود.
بنویسید «آیه» تا آیه ارسال شود.
بنویسید «چالش» تا مسابقه شروع شود.
بنویسید «صندوق شانس» تا صندوق شانس باز شود.
بنویسید «بازیکن برتر» تا برترین‌های گروه نمایش داده شوند (روی اسم بزنید تا پروفایلش باز شود).
بنویسید «پروفایل» تا آمار خودتان نمایش داده شود.

• گزینه «🎁 شانس» :
هر ۱۵ دقیقه یک‌بار می‌توانید صندوق را باز کنید؛ ممکن است امتیاز بگیرید، امتیاز از دست بدهید یا پوچ باشد.

• کمبو (Combo) :
اگر چند سؤال را پشت سر هم درست پاسخ دهید، جایزه‌ی ویژه می‌گیرید.
کمبوی شما با پاسخ اشتباه از بین می‌رود.

• دستاوردها (Achievements) :
با انجام فعالیت‌های مختلف، مدال و دستاورد دریافت کنید.

• گزینه «پروفایل»
امتیاز، رتبه و آمار پاسخ‌هایتان را نشان می‌دهد.

• گزینه «علاقه‌مندی‌ها»
احادیثی که با دکمه‌ی 📜 ذخیره کرده‌اید را نشان می‌دهد.

• گزینه «دعوت دوستان»
لینک دعوت اختصاصی شما؛ با هر دعوت موفق ۱۵ امتیاز جایزه می‌گیرید.

🎖️ راهنمای عنوان‌ها :
عنوان‌ها افتخارهایی هستند که با انجام فعالیت‌های خاص به دست می‌آورید. برخلاف رتبه، عنوان‌ها با امتیاز افزایش پیدا نمی‌کنند و هرکدام شرط مخصوص خود را دارند.

⚔ شکارچی کمبو
• رسیدن به کمبو ۱۰ پاسخ صحیح پشت سر هم.

🎯 بی‌خطا
• پاسخ صحیح به ۲۰ سؤال بدون حتی یک اشتباه.

⚡ برق‌آسا
• پاسخ صحیح به یک چالش در کمتر از ۵ ثانیه.

👥 دعوت‌گر
• دعوت موفق ۱۰ نفر به ربات.

⚜️ وفادار
• حضور فعال به مدت ۵۰ روز.

💎 افسانه
• کسب تمام عنوان‌های موجود.

━━━━━━━━━━━━━━━━━
🌱 نسخه‌ی اولیه‌ی ربات نورالحدیث`;
  await sendMessage(env, chatId, helpText);
}

async function sendSupport(env, chatId) {
  const link = env.SUPPORT_USERNAME || 'https://t.me/Coreora';
  await sendMessage(env, chatId, `در صورت وجود مشکل یا پیشنهاد :\n\n${link}`);
}

// ---------- Callback handling ----------
async function handleCallback(callback, env, ctx) {
  const data = callback.data || '';
  const chatId = callback.message.chat.id;
  const messageId = callback.message.message_id;
  const chatType = callback.message.chat.type;
  const isGroup = chatType === 'group' || chatType === 'supergroup';

  if (data.startsWith('another:')) {
    const excludeIndex = parseInt(data.split(':')[1], 10);
    const raw = await getHadiths(env);
    if (raw.length > 0) {
      let idx;
      if (raw.length === 1) idx = 0;
      else {
        do { idx = Math.floor(Math.random() * raw.length); } while (idx === excludeIndex);
      }
      const entry = normalizeHadithEntry(raw[idx], idx);
      await editMessageText(env, chatId, messageId, buildHadithMessage(entry), {
        reply_markup: hadithInlineKeyboard(entry.text, isGroup, entry.index),
      });
    }
    await answerCallbackQuery(env, callback.id);
    return;
  }

  if (data.startsWith('anotherayah:')) {
    const excludeIndex = parseInt(data.split(':')[1], 10);
    const raw = await getAyat(env);
    if (raw.length > 0) {
      let idx;
      if (raw.length === 1) idx = 0;
      else {
        do { idx = Math.floor(Math.random() * raw.length); } while (idx === excludeIndex);
      }
      const entry = normalizeAyahEntry(raw[idx], idx);
      await editMessageText(env, chatId, messageId, buildAyahMessage(entry), {
        reply_markup: ayahInlineKeyboard(entry.text, isGroup, entry.index),
      });
    }
    await answerCallbackQuery(env, callback.id);
    return;
  }

  if (data.startsWith('favayah:')) {
    const idx = parseInt(data.split(':')[1], 10);
    const raw = await getAyat(env);
    if (idx >= 0 && idx < raw.length) {
      const entry = normalizeAyahEntry(raw[idx], idx);
      const added = await addFavorite(env, callback.from.id, { text: entry.text, imam: null });
      await answerCallbackQuery(env, callback.id, added ? '📜 به علاقه‌مندی‌ها اضافه شد.' : 'این آیه قبلاً ذخیره شده بود.');
    } else {
      await answerCallbackQuery(env, callback.id, 'خطا در ذخیره‌سازی.');
    }
    return;
  }

  if (data.startsWith('chal:')) {
    const parts = data.split(':');
    const challengeId = `${parts[1]}:${parts[2]}`;
    const optIdx = parseInt(parts[3], 10);

    const raw = await env.HADITHS.get(`challenge:${challengeId}`);
    if (!raw) {
      await answerCallbackQuery(env, callback.id, 'این چالش دیگر معتبر نیست.');
      return;
    }
    const state = JSON.parse(raw);
    if (state.resolved) {
      await answerCallbackQuery(env, callback.id, 'قبلاً پاسخ داده شده است.');
      return;
    }
    if (Date.now() > state.deadline) {
      await answerCallbackQuery(env, callback.id, 'زمان تمام شده است.');
      return;
    }
    state.resolved = true;
    await env.HADITHS.put(`challenge:${challengeId}`, JSON.stringify(state), { expirationTtl: 120 });

    const chosen = state.options[optIdx];
    const isCorrect = chosen === state.correctAnswer;
    const user = callback.from;

    // امتیازدهی: پاسخ درست ۱۰ امتیاز، پاسخ اشتباه منفی ۵ امتیاز
    const base = isCorrect ? 10 : -5;

    // وضعیت قبلی کاربر برای محاسبه‌ی کمبو و دستاوردها (اگه دیتابیس هنوز کامل آپدیت نشده، خطا رو نادیده می‌گیریم)
    let oldRow = null;
    try {
      if (env.DB) {
        oldRow = await env.DB.prepare('SELECT combo, correct_count, wrong_count, total_score, current_streak, days_active FROM users WHERE user_id = ?').bind(user.id).first();
      }
    } catch (err) {
      console.error('read oldRow error:', err);
    }
    const oldCombo = (oldRow && oldRow.combo) || 0;
    const oldCorrect = (oldRow && oldRow.correct_count) || 0;
    const oldWrong = (oldRow && oldRow.wrong_count) || 0;
    const oldScore = (oldRow && oldRow.total_score) || 0;
    const oldStreak = (oldRow && oldRow.current_streak) || 0;
    const oldDaysActive = (oldRow && oldRow.days_active) || 0;

    const newCombo = isCorrect ? oldCombo + 1 : 0;
    let comboBonus = 0;
    let comboMsg = '';
    if (newCombo === 3) { comboBonus = 5; comboMsg = '\n🔥 کمبوی ۳ تایی! ۵ امتیاز جایزه گرفتی.'; }
    else if (newCombo === 5) { comboBonus = 15; comboMsg = '\n⚡ کمبوی ۵ تایی! ۱۵ امتیاز جایزه گرفتی.'; }
    else if (newCombo === 10) { comboBonus = 50; comboMsg = '\n👑 کمبوی ۱۰ تایی! ۵۰ امتیاز جایزه گرفتی.'; }

    const points = base + comboBonus;
    let streak = oldStreak;
    const unlocked = [];
    let newTitles = [];

    try {
      await upsertUserAnswer(env, user, isCorrect, points);
      await upsertGroupScore(env, user.id, chatId, points, isCorrect);
      await upsertDailyScore(env, user.id, chatId, todayStr(), points);
      streak = await updateStreak(env, user.id);
      if (env.DB) {
        await env.DB.prepare('UPDATE users SET combo = ? WHERE user_id = ?').bind(newCombo, user.id).run();
      }

      // بررسی دستاوردهای تازه باز شده
      const newCorrect = oldCorrect + (isCorrect ? 1 : 0);
      const newScore = oldScore + points;
      if (isCorrect && oldCorrect === 0) unlocked.push('🥉 اولین پاسخ صحیح');
      if (oldCorrect < 30 && newCorrect >= 30) unlocked.push('⚡ ۳۰ پاسخ صحیح');
      if (oldScore < 100 && newScore >= 100) unlocked.push('🥈 ۱۰۰ امتیاز');
      if (oldStreak < 7 && streak >= 7) unlocked.push('🔥 ۷ روز متوالی');

      // بررسی عنوان‌های ویژه
      if (env.DB) {
        if (newCombo === 10) {
          newTitles = newTitles.concat(await unlockTitle(env, user.id, 'combo10'));
        }
        const elapsed = Date.now() - (state.startTime || 0);
        if (isCorrect && state.startTime && elapsed <= 5000) {
          newTitles = newTitles.concat(await unlockTitle(env, user.id, 'speed5'));
        }
        if (isCorrect && oldWrong === 0 && newCorrect >= 20) {
          newTitles = newTitles.concat(await unlockTitle(env, user.id, 'flawless20'));
        }
        if (oldDaysActive < 50) {
          const freshRow = await env.DB.prepare('SELECT days_active FROM users WHERE user_id = ?').bind(user.id).first();
          if (freshRow && freshRow.days_active >= 50) {
            newTitles = newTitles.concat(await unlockTitle(env, user.id, 'loyal50'));
          }
        }
      }
    } catch (err) {
      console.error('scoring pipeline error:', err);
    }

    const name = user.first_name || user.username || 'کاربر';
    const pointsLine = isCorrect ? ` (+${points} امتیاز)` : ` (${points} امتیاز)`;
    const resultLine = isCorrect
      ? `✅ ${escapeHtml(name)} پاسخ درست داد!${pointsLine}${comboMsg}\n\nپاسخ درست: ${state.correctAnswer}`
      : `❌ ${escapeHtml(name)} پاسخ اشتباه داد.${pointsLine}\n\nپاسخ درست: ${state.correctAnswer}`;
    await editMessageText(env, chatId, messageId, resultLine, { parse_mode: 'HTML' });
    await answerCallbackQuery(env, callback.id, isCorrect ? 'آفرین! ✅' : 'اشتباه بود ❌');

    if (unlocked.length > 0) {
      await sendMessage(env, chatId, `🎉 Achievement Unlocked برای ${escapeHtml(name)}!\n\n${unlocked.join('\n')}`, { parse_mode: 'HTML' });
    }
    if (newTitles.length > 0) {
      await announceNewTitles(env, chatId, name, newTitles);
    }
    return;
  }


  if (data.startsWith('fav:')) {
    const idx = parseInt(data.split(':')[1], 10);
    const raw = await getHadiths(env);
    if (idx >= 0 && idx < raw.length) {
      const entry = normalizeHadithEntry(raw[idx], idx);
      const added = await addFavorite(env, callback.from.id, entry);
      await answerCallbackQuery(env, callback.id, added ? '📜 به علاقه‌مندی‌ها اضافه شد.' : 'این حدیث قبلاً ذخیره شده بود.');
    } else {
      await answerCallbackQuery(env, callback.id, 'خطا در ذخیره‌سازی.');
    }
    return;
  }

  if (data === 'top_player') {
    await sendGlobalTopPlayers(env, chatId);
    await answerCallbackQuery(env, callback.id);
    return;
  }

  if (data === 'luckybox:open') {
    await openLuckyBox(env, chatId, callback.from);
    await answerCallbackQuery(env, callback.id);
    return;
  }

  await answerCallbackQuery(env, callback.id);
}

// ---------- Telegram API wrapper ----------
async function tgApi(env, method, payload) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

function sendMessage(env, chatId, text, extra = {}) {
  return tgApi(env, 'sendMessage', { chat_id: chatId, text, ...extra });
}

function editMessageText(env, chatId, messageId, text, extra = {}) {
  return tgApi(env, 'editMessageText', { chat_id: chatId, message_id: messageId, text, ...extra });
}

function answerCallbackQuery(env, callbackId, text) {
  return tgApi(env, 'answerCallbackQuery', { callback_query_id: callbackId, text });
}
