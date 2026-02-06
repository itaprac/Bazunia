// docs-navigation.js — robust anchor navigation and active section sync for docs

const docsNavStates = new WeakMap();

function decodeHashId(value) {
  if (!value) return '';
  try {
    return decodeURIComponent(String(value).replace(/^#/, '').trim());
  } catch {
    return String(value).replace(/^#/, '').trim();
  }
}

function getSectionIdFromHref(href) {
  if (!href) return '';
  if (href.startsWith('#')) return decodeHashId(href);
  try {
    const url = new URL(href, window.location.href);
    return decodeHashId(url.hash);
  } catch {
    return '';
  }
}

function updateHash(id) {
  if (!id) return;
  const encoded = encodeURIComponent(id);
  if (window.location.hash === `#${encoded}`) return;
  const nextUrl = `${window.location.pathname}${window.location.search}#${encoded}`;
  window.history.replaceState(null, '', nextUrl);
}

function smoothScrollToElement(element) {
  if (!element) return;
  const top = Math.max(0, element.getBoundingClientRect().top + window.scrollY - 12);
  window.scrollTo({ top, behavior: 'smooth' });
}

function isVisible(el) {
  if (!el) return false;
  return el.getClientRects().length > 0;
}

function collectDocsContainers(root) {
  if (!root) return [];
  if (root instanceof Element && root.classList.contains('docs-content')) {
    return [root];
  }
  return Array.from(root.querySelectorAll('.docs-content'));
}

function setupContainer(container) {
  const existing = docsNavStates.get(container);
  if (existing) return existing;

  const toc = container.querySelector('.docs-toc');
  if (!toc) return null;

  const rawLinks = Array.from(toc.querySelectorAll('a[href]'));
  const items = [];
  const seen = new Set();

  rawLinks.forEach((link) => {
    const id = getSectionIdFromHref(link.getAttribute('href'));
    if (!id || seen.has(id)) return;
    const target = container.querySelector(`#${id}`);
    if (!target) return;
    seen.add(id);
    link.dataset.docsTarget = id;
    items.push({ id, link, target });
  });

  if (!items.length) return null;

  const itemsById = new Map(items.map((item) => [item.id, item]));
  let activeId = '';
  let scrollTicking = false;

  function setActive(id) {
    if (!id || id === activeId) return;
    activeId = id;
    items.forEach((item) => {
      item.link.classList.toggle('active', item.id === id);
    });
  }

  function updateActiveFromScroll() {
    if (!isVisible(container)) return;
    const offset = 140;
    let nextActive = items[0].id;

    for (const item of items) {
      if (item.target.getBoundingClientRect().top - offset <= 0) {
        nextActive = item.id;
      } else {
        break;
      }
    }
    setActive(nextActive);
  }

  function onScrollOrResize() {
    if (scrollTicking) return;
    scrollTicking = true;
    window.requestAnimationFrame(() => {
      scrollTicking = false;
      updateActiveFromScroll();
    });
  }

  function goToSection(id, { updateUrlHash = true } = {}) {
    const item = itemsById.get(id);
    if (!item) return false;
    setActive(id);
    smoothScrollToElement(item.target);
    if (updateUrlHash) updateHash(id);
    return true;
  }

  function syncFromHash() {
    const id = decodeHashId(window.location.hash);
    if (!id) return false;
    const handled = goToSection(id, { updateUrlHash: false });
    return handled;
  }

  items.forEach((item) => {
    item.link.addEventListener('click', (event) => {
      event.preventDefault();
      goToSection(item.id);
    });
  });

  let backToTop = toc.querySelector('.docs-back-to-top');
  if (!backToTop) {
    backToTop = document.createElement('button');
    backToTop.type = 'button';
    backToTop.className = 'btn btn-secondary btn-sm docs-back-to-top';
    backToTop.textContent = 'Na początek';
    toc.appendChild(backToTop);
  }
  backToTop.addEventListener('click', () => {
    const firstId = items[0]?.id;
    if (firstId) goToSection(firstId);
  });

  window.addEventListener('scroll', onScrollOrResize, { passive: true });
  window.addEventListener('resize', onScrollOrResize);
  window.addEventListener('hashchange', syncFromHash);

  const state = {
    syncFromHash,
    refresh() {
      updateActiveFromScroll();
    },
  };

  docsNavStates.set(container, state);

  if (!syncFromHash()) {
    updateActiveFromScroll();
  }

  return state;
}

export function initDocsNavigation(root = document) {
  const containers = collectDocsContainers(root);
  containers.forEach((container) => {
    const state = setupContainer(container);
    if (state) {
      state.syncFromHash();
      state.refresh();
    }
  });
}
