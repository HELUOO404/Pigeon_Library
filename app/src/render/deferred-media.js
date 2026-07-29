// deferred-media.js — 课程图片的视口分级加载、占位、WebP 优先与原图回退。

function escapeAttr(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function webImageVariant(src) {
  const value = String(src || '');
  const match = value.match(/^(\/courses\/.*)\/assets\/images\/(.*\.(?:png|jpe?g|bmp))$/i);
  return match ? `${match[1]}/assets/generated/images/${match[2]}.webp` : '';
}

export function deferredImage(src, alt = '', className = '') {
  const webp = webImageVariant(src);
  return `<span class="media-placeholder ${escapeAttr(className)}" data-media-state="pending"><img class="deferred-image" data-src="${escapeAttr(src)}"${webp ? ` data-webp="${escapeAttr(webp)}"` : ''} alt="${escapeAttr(alt)}" decoding="async"><span class="media-placeholder-label" aria-hidden="true">图片正在投递…</span></span>`;
}

function prepareLegacyImages(root) {
  for (const image of Array.from(root.querySelectorAll('.course-html img[src]') || [])) {
    if (image.closest('.media-placeholder')) continue;
    const placeholder = document.createElement('span');
    placeholder.className = 'media-placeholder course-image';
    placeholder.dataset.mediaState = 'pending';
    const label = document.createElement('span');
    label.className = 'media-placeholder-label';
    label.setAttribute('aria-hidden', 'true');
    label.textContent = '图片正在投递…';
    const src = image.getAttribute('src');
    image.dataset.src = src;
    const webp = webImageVariant(src);
    if (webp) image.dataset.webp = webp;
    image.removeAttribute('src');
    image.removeAttribute('loading');
    image.classList.add('deferred-image');
    image.before(placeholder);
    placeholder.append(image, label);
  }
}

function loadPlaceholder(placeholder, root) {
  if (placeholder.dataset.mediaState !== 'pending' || !placeholder.isConnected || !root.contains(placeholder)) return;
  const image = placeholder.querySelector('img[data-src]');
  if (!image) return;
  placeholder.dataset.mediaState = 'loading';
  delete image.dataset.retry;
  image.onload = () => {
    image.onload = null;
    image.onerror = null;
    placeholder.dataset.mediaState = 'loaded';
  };
  image.onerror = () => {
    if (image.dataset.webp && image.dataset.mediaAttempt !== 'original') {
      image.dataset.mediaAttempt = 'original';
      image.src = image.dataset.src;
      return;
    }
    image.onload = null;
    image.onerror = null;
    placeholder.dataset.mediaState = 'error';
    const label = placeholder.querySelector('.media-placeholder-label');
    if (label) label.textContent = '图片投递失败 · 点击重试';
    image.removeAttribute('src');
    image.dataset.retry = '1';
  };
  image.dataset.mediaAttempt = image.dataset.webp ? 'webp' : 'original';
  image.src = image.dataset.webp || image.dataset.src;
}

export function loadDeferredImages(root, limit = Infinity) {
  if (!root?.querySelectorAll) return 0;
  const count = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : Infinity;
  const placeholders = Array.from(root.querySelectorAll('.media-placeholder[data-media-state="pending"]')).slice(0, count);
  placeholders.forEach((placeholder) => loadPlaceholder(placeholder, root));
  return placeholders.length;
}

export function initDeferredMedia(root = document) {
  if (!root?.querySelectorAll || typeof window === 'undefined') return () => {};
  prepareLegacyImages(root);
  const placeholders = Array.from(root.querySelectorAll('.media-placeholder[data-media-state="pending"]') || [])
    .filter((placeholder) => !placeholder.dataset.mediaBound);
  if (!placeholders.length) return () => {};

  let disposed = false;
  let observer;
  const retryListeners = new Map();
  const load = (placeholder) => {
    if (disposed) return;
    loadPlaceholder(placeholder, root);
  };

  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        load(entry.target);
      }
    }, { rootMargin: '800px 0px' });
  }

  placeholders.forEach((placeholder) => {
    placeholder.dataset.mediaBound = '1';
    const retry = () => {
      if (placeholder.dataset.mediaState !== 'error') return;
      placeholder.dataset.mediaState = 'pending';
      const image = placeholder.querySelector('img[data-src]');
      const label = placeholder.querySelector('.media-placeholder-label');
      if (label) label.textContent = '图片正在重新投递…';
      if (image) {
        delete image.dataset.retry;
        delete image.dataset.mediaAttempt;
      }
      load(placeholder);
    };
    retryListeners.set(placeholder, retry);
    placeholder.addEventListener('click', retry);
    if (observer) observer.observe(placeholder);
    else load(placeholder);
  });

  return () => {
    if (disposed) return;
    disposed = true;
    observer?.disconnect();
    retryListeners.forEach((listener, placeholder) => {
      placeholder.removeEventListener('click', listener);
      delete placeholder.dataset.mediaBound;
    });
    retryListeners.clear();
  };
}
