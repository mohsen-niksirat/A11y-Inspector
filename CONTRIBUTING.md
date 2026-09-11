# Contributing to A11y Inspector / مشارکت در A11y Inspector

Thanks for your interest in improving A11y Inspector! This guide is bilingual — write in whichever language is easier for you. / از علاقه‌ی شما به بهبود A11y Inspector ممنونیم. این راهنما دوزبانه است — به هر زبانی که راحت‌ترید بنویسید.

---

## فارسی

### پیش از شروع

- باگ را در [Issues](../../issues) جستجو کنید تا مطمئن شوید تکراری نیست.
- برای تغییرهای بزرگ (قانون جدید، بازطراحی UI) اول یک Issue باز کنید تا مسیر موافقت شود.
- این پروژه بدون Backend و بدون Build Step است؛ همین رویکرد را حفظ کنید.

### راه‌اندازی محلی

```bash
git clone https://github.com/mohsen-niksirat/A11y-Inspector.git
cd A11y-Inspector
python -m http.server 4173
# سپس http://localhost:4173 را باز کنید
```

برای اجرای تست‌ها Node نسخه ۱۸ یا بالاتر لازم است:

```bash
npm test        # تست‌های موتور ممیزی
npm run check   # بررسی سینتکس app.js
npm run verify  # هر دو
```

### افزودن قانون ممیزی جدید

1. در `app.js` یک ورودی به آرایه‌ی `rules` اضافه کنید (`id`، `severity`، `wcag`، `title`، `desc`).
2. منطق تشخیص را داخل تابع `audit` بنویسید؛ برای هر عنصر مشکل‌دار `fail(...)` و در صورت سالم بودن یک `pass(...)` کلی صادر کنید.
3. عنوان و توضیح قانون را برای هر شش زبان به `RULE_TITLES` و `RULE_DESCS` اضافه کنید (fa، en، ar، de، fr، es).
4. اگر منطق شما helper خالص جدیدی دارد (بدون وابستگی به DOM)، برای آن تست در `tests/engine.test.mjs` بنویسید.
5. تغییر را با هر سه نمونه‌ی آماده و یک سند ساختگی دستی تست کنید.

### استانداردهای کد

- `app.js` از قاعده‌ی «هر helper خالص در یک خط» پیروی می‌کند؛ تست‌ها به این ساختار تکیه دارند.
- خروجی HTML تولیدشده همیشه از `esc()` عبور کند.
- تغییر UI باید با هر دو تم Dark/Light و در RTL/LTR درست باشد.
- Performance: ممیزی باید برای اسناد چند صد کیلوبایتی زیر ~۵۰ms بماند.

### ارسال Pull Request

1. از `main` یک شاخه بسازید: `git checkout -b feat/my-feature`
2. کامیت‌های کوچک و توصیفی بنویسید.
3. قبل از ارسال، `npm run verify` باید بدون خطا رد شود — CI همین را روی هر PR اجرا می‌کند.
4. PR را با قالب آماده باز کنید و سناریوی تست‌شده را توضیح دهید.

---

## English

### Before you start

- Search [Issues](../../issues) to avoid duplicates.
- For larger changes (new audit rules, UI redesigns) open an issue first to align on the approach.
- This project is intentionally backend-free and build-step-free; please keep it that way.

### Local setup

```bash
git clone https://github.com/mohsen-niksirat/A11y-Inspector.git
cd A11y-Inspector
python -m http.server 4173
# then open http://localhost:4173
```

Node 18+ is required for the tests:

```bash
npm test        # audit engine tests
npm run check   # app.js syntax check
npm run verify  # both
```

### Adding a new audit rule

1. Add an entry to the `rules` array in `app.js` (`id`, `severity`, `wcag`, `title`, `desc`).
2. Implement detection inside the `audit` function; emit `fail(...)` per offending element and one overall `pass(...)` when clean.
3. Add the rule title and description to `RULE_TITLES` and `RULE_DESCS` for all six languages (fa, en, ar, de, fr, es).
4. If your logic introduces a new pure helper (no DOM dependency), add unit tests in `tests/engine.test.mjs`.
5. Verify the change against all three built-in samples and a hand-made document.

### Code standards

- `app.js` follows a "one pure helper per line" convention; the test harness relies on it.
- Any generated HTML output must go through `esc()`.
- UI changes must work in both dark/light themes and RTL/LTR.
- Performance: auditing a few-hundred-KB document should stay under ~50ms.

### Submitting a Pull Request

1. Branch from `main`: `git checkout -b feat/my-feature`
2. Keep commits small and descriptive.
3. `npm run verify` must pass before you push — CI runs exactly that on every PR.
4. Open the PR using the provided template and describe the scenarios you tested.

---

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
