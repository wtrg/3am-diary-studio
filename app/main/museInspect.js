'use strict';

// Runs inside the Muse page. It returns only selectors/labels, never page text
// from messages, so private chat content is not sent back to the app UI.
const INSPECT_SELECTORS_SCRIPT = `
(() => {
  const visible = (el) => {
    if (!el || !el.getClientRects().length) return false;
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || 1) > 0.01 && r.width > 0 && r.height > 0;
  };
  const attrValue = (value) => String(value || '').replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"');
  const unique = (selector) => {
    try { return document.querySelectorAll(selector).length === 1; } catch { return false; }
  };
  const selectorFor = (el) => {
    if (el.id) {
      const byId = '#' + CSS.escape(el.id);
      if (unique(byId)) return byId;
    }
    const tag = el.tagName.toLowerCase();
    for (const attr of ['data-testid', 'name', 'aria-label', 'placeholder']) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      const selector = tag + '[' + attr + '="' + attrValue(value) + '"]';
      if (unique(selector)) return selector;
    }
    const classes = [...el.classList].filter((name) => /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(name)).slice(0, 3);
    for (let count = classes.length; count > 0; count -= 1) {
      const selector = tag + '.' + classes.slice(0, count).map((name) => CSS.escape(name)).join('.');
      if (unique(selector)) return selector;
    }
    const parts = [];
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && depth < 5; depth += 1) {
      const parent = node.parentElement;
      if (!parent) break;
      const sameTag = [...parent.children].filter((child) => child.tagName === node.tagName);
      const index = sameTag.indexOf(node) + 1;
      parts.unshift(node.tagName.toLowerCase() + ':nth-of-type(' + index + ')');
      const selector = parts.join(' > ');
      if (unique(selector)) return selector;
      node = parent;
    }
    return null;
  };
  const label = (el) => String(
    el.getAttribute('aria-label') ||
    el.getAttribute('placeholder') ||
    el.getAttribute('data-testid') ||
    el.innerText ||
    el.value ||
    el.tagName
  ).replace(/\\s+/g, ' ').trim().slice(0, 100);
  const collect = (elements, limit = 12) => {
    const seen = new Set();
    const out = [];
    for (const el of elements) {
      if (!visible(el)) continue;
      const selector = selectorFor(el);
      if (!selector || seen.has(selector)) continue;
      seen.add(selector);
      out.push({ selector, label: label(el), tag: el.tagName.toLowerCase() });
      if (out.length >= limit) break;
    }
    return out;
  };
  const inputs = collect([
    ...document.querySelectorAll('textarea, input[type="text"], input:not([type]), [contenteditable="true"], [role="textbox"]'),
  ]);
  const buttons = [...document.querySelectorAll('button, [role="button"], input[type="submit"]')];
  const sendButtons = collect(buttons.filter((el) => /send|gửi|submit|arrow|gửi đi|gửi tin/i.test(label(el))));
  const responses = collect([
    ...document.querySelectorAll('[aria-live], [role="log"], [data-testid*="message" i], [data-testid*="response" i], [data-message]'),
  ], 10);
  const loginHints = collect(buttons.filter((el) => /login|log in|đăng nhập|account|tài khoản|profile|hồ sơ|sign in/i.test(label(el))), 8);
  return {
    url: location.href,
    title: document.title,
    groups: { inputs, sendButtons, responses, loginHints },
  };
})()
`;

module.exports = { INSPECT_SELECTORS_SCRIPT };
