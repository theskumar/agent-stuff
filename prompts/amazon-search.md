---
description: Search Amazon products, extract listings/reviews via DOM, and recommend based on user requirements
allowedTools: Bash, Read, Write
---

You are helping the user find and pick a product on Amazon. The input is: $ARGUMENTS

Default marketplace: amazon.in (switch domain if the user asks).

## Steps

### 0. Gather requirements first

Before searching, ask the user for whatever is missing (skip what's already given):

- Exact use case and what it must hold/fit/connect to (model numbers help — look up specs like weight/dimensions yourself)
- Hard constraints (size, mounting, compatibility, room/desk situation)
- Budget range
- Future/upgrade plans (these often change the right pick)
- Color/brand/warranty preferences

### 1. Start the browser

Use the web-browser skill:

```bash
cd ~/.agents/skills/web-browser
./scripts/start.js --stealth 2>&1 | tail -3
```

### 2. Search via URL, extract via DOM

Never screenshot search pages — parse the DOM. Navigate directly to a search URL:

```
https://www.amazon.in/s?k=<query+terms>
```

Useful URL filters:
- **Price range**: `&rh=p_36%3AMIN-MAX` where values are in **paise** (₹5,000–₹10,000 → `p_36%3A500000-1000000`)
- Run 2–3 query variants (generic term, spec-qualified term, accessory/combo term) to cover the space

Extract results with `eval.js` (sleep ~4s after nav):

```bash
./scripts/eval.js '(function(){
  const items = [...document.querySelectorAll("div[data-component-type=\"s-search-result\"]")];
  return JSON.stringify(items.slice(0, 16).map(it => {
    const title = it.querySelector("h2 span")?.textContent?.trim();
    const price = it.querySelector(".a-price .a-offscreen")?.textContent;
    const mrp = it.querySelector(".a-price.a-text-price .a-offscreen")?.textContent;
    const rating = it.querySelector(".a-icon-alt")?.textContent?.split(" ")[0];
    const reviews = it.querySelector("span.a-size-base.s-underline-text")?.textContent;
    const link = it.querySelector("h2 a, a.a-link-normal")?.getAttribute("href");
    const sponsored = !!it.querySelector(".puis-sponsored-label-text, .s-sponsored-label-text");
    return {title: title?.slice(0,120), price, mrp, rating, reviews, sponsored,
      link: link && !link.includes("sspa") ? "https://www.amazon.in" + link.split("/ref=")[0] : null};
  }).filter(x => x.title), null, 1);
})()'
```

Gotchas learned the hard way:

- **Sponsored links** go through `/sspa/click?...` redirects — null them out; the same product usually appears again organically with a clean `/dp/ASIN` link. Dedupe sponsored+organic duplicates by title.
- **Strip `/ref=...`** from links to get clean canonical URLs.
- **Fake MRPs**: anchor prices like ₹2,19,900 against a ₹2,199 sale price are listing games — ignore discount % as a signal.
- **eval.js escaping**: the script is single-quoted shell → use `\"` for JS strings, and avoid constructs like `split(" \")` that nest escaped quotes (causes `SyntaxError: Invalid or unexpected token`). Keep string literals simple.

### 3. Verify finalists on their product pages

For the 2–3 shortlisted products, open each `/dp/ASIN` page and pull review data:

```bash
./scripts/nav.js "<product-url>" && sleep 5
./scripts/eval.js '(function(){
  const total = document.querySelector("#acrCustomerReviewText")?.textContent;
  const avg = document.querySelector("#acrPopover")?.title;
  const reviews = [...document.querySelectorAll("div[data-hook=\"review\"]")].slice(0,8)
    .map(r => r.innerText.replace(/\n+/g, " | ").slice(0,350));
  return JSON.stringify({total, avg, reviews}, null, 1);
})()'
```

- Use **`innerText` on `div[data-hook="review"]`**, not nested selectors — Amazon's inner review markup is brittle and structured selectors often return empty.
- Full review pages beyond the product page require login; the ~8 top reviews on the product page are usually enough.
- **Read the critical reviews for spec caveats** the listing hides (e.g., "max height only 41cm", "gas spring minimum weight 5kg", "clamp scratches desk"). One honest 3–4★ review beats ten 5★ ones.
- **Zero reviews on a new listing ≠ unknown product**: web-search the model number. Many Indian listings are rebrands of international products (e.g., "SYGA NB G55" = North Bayou G55; "ELG F160N" = North Bayou F160 with a 42k global review pool). Global reviews and official spec sheets fill the gap.

### 4. Check specs against requirements — minimums too

- Look up the user's existing gear weight/dimensions (e.g., monitor weight without stand) and check it against the product's supported range.
- **Check spec minimums, not just maximums** — e.g., a gas-spring arm rated 5–16kg will drift with a 3.5kg load. Maximums get marketed; minimums get buried.
- Re-check fit against the user's *future* plans (upgrade headroom may flip the recommendation).

### 5. Present recommendations

- Markdown table per tier/category: product (linked), price, rating + review count, one-line "why".
- Quote 2–3 representative review snippets (✅ pros, ⚠️ caveats) for finalists.
- Give one clear verdict with reasoning tied to the user's stated requirements, plus a runner-up and when to prefer it.
- Show a total if recommending a bundle, compared against budget.
- End by offering a concrete next step (verify a spec, check delivery, compare another option).
