import { icon } from './icons.js';

const ICONS = {
  success: 'check',
  error: 'circle-x',
  info: 'send',
};

let stack;

function ensureStack() {
  if (stack) return stack;
  stack = document.createElement('div');
  stack.className = 'toast-stack';
  stack.setAttribute('role', 'status');
  stack.setAttribute('aria-live', 'polite');
  document.body.appendChild(stack);
  return stack;
}

function removeToast(node) {
  node.classList.remove('show');
  node.classList.add('hide');
  window.setTimeout(() => node.remove(), 180);
}

export function toast(message, opts = {}) {
  const { type = 'info', duration = 2600 } = opts;
  const safeType = Object.hasOwn(ICONS, type) ? type : 'info';
  const node = document.createElement('div');
  node.className = `toast toast-${safeType}`;

  const mark = document.createElement('span');
  mark.className = 'toast-icon';
  mark.innerHTML = icon(ICONS[safeType], { size: 17 });

  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = message;

  const close = document.createElement('button');
  close.className = 'toast-close';
  close.type = 'button';
  close.setAttribute('aria-label', '关闭通知');
  close.innerHTML = icon('x', { size: 15 });
  close.addEventListener('click', () => removeToast(node));

  node.append(mark, text, close);
  ensureStack().appendChild(node);
  requestAnimationFrame(() => node.classList.add('show'));

  if (duration > 0) {
    window.setTimeout(() => removeToast(node), duration);
  }
}
