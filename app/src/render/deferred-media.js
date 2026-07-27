// deferred-media.js — 课程图片的视口分级加载、占位、WebP 优先与原图回退。

function escapeAttr(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function webImageVariant(src) {
  const value = String(src || '');
  return /^\/courses\/.*\/assets\/images\/.*\.(?:png|jpe?g|bmp)$/i.test(value) ? `${value}.webp` : '';
}

export function deferredImage(src, alt = '', className = '') {
  const webp = webImageVariant(src);
  return `<span class="media-placeholder ${escapeAttr(className)}" data-media-state="pending"><img class="deferred-image" data-src="${escapeAttr(src)}"${webp ? ` data-webp="${escapeAttr(webp)}"` : ''} alt="${escapeAttr(alt)}" decoding="async"><span class="media-placeholder-label" aria-hidden="true">图片正在投递…</span></span>`;
}

export function initDeferredMedia(root = document) {
  if (!root?.querySelectorAll || typeof window === 'undefined') return;
  for (const image of Array.from(root.querySelectorAll('.course-html img[src]') || [])) {
    if (image.closest('.media-placeholder')) continue;
    const placeholder = document.createElement('span');
    placeholder.className = 'media-placeholder course-image';
    placeholder.dataset.mediaState = 'pending';
    const label = document.createElement('span');
    label.className = 'media-placeholder-label';
    label.setAttribute('aria-hidden', 'true');
    label.textContent = '图片正在投递…';
    image.dataset.src = image.getAttribute('src');
    image.removeAttribute('src');
    image.removeAttribute('loading');
    image.classList.add('deferred-image');
    image.before(placeholder);
    placeholder.append(image, label);
  }
  const placeholders = Array.from(root.querySelectorAll('.media-placeholder[data-media-state="pending"]') || []);
  if (!placeholders.length) return;
  const load = (placeholder) => {
    if (placeholder.dataset.mediaState !== 'pending') return;
    const image = placeholder.querySelector('img[data-src]');
    if (!image) return;
    placeholder.dataset.mediaState = 'loading';
    image.onload = () => {
      image.onload = null;
      image.onerror = null;
      placeholder.dataset.mediaState = 'loaded';
    };
    image.onerror = () => {
      if (image.dataset.webp && image.src.endsWith('.webp')) {
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
    image.src = image.dataset.webp || image.dataset.src;
  };
  if (!('IntersectionObserver' in window)) {
    placeholders.forEach(load);
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      load(entry.target);
    }
  }, { rootMargin: '800px 0px' });
  placeholders.forEach((placeholder) => {
    placeholder.addEventListener('click', () => {
      if (placeholder.dataset.mediaState !== 'error') return;
      placeholder.dataset.mediaState = 'pending';
      const image = placeholder.querySelector('img[data-src]');
      const label = placeholder.querySelector('.media-placeholder-label');
      if (label) label.textContent = '图片正在重新投递…';
      if (image) delete image.dataset.retry;
      load(placeholder);
    });
    observer.observe(placeholder);
  });
}
