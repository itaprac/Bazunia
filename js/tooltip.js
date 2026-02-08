// tooltip.js — Global delegated tooltip system

const TOOLTIP_SELECTOR = '[data-tooltip]';
const SPACING = 10;

let initialized = false;
let tooltipEl = null;
let activeTarget = null;
let showTimer = null;
let settings = {
  defaultDelay: 450,
  defaultPlacement: 'top',
};
let lastInteractionWasKeyboard = false;

function supportsHoverInput() {
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

function ensureTooltipElement() {
  if (tooltipEl) return tooltipEl;
  tooltipEl = document.createElement('div');
  tooltipEl.className = 'app-tooltip';
  tooltipEl.setAttribute('role', 'tooltip');
  tooltipEl.setAttribute('aria-hidden', 'true');
  document.body.appendChild(tooltipEl);
  return tooltipEl;
}

function clearShowTimer() {
  if (!showTimer) return;
  clearTimeout(showTimer);
  showTimer = null;
}

function getPlacementForTarget(target) {
  const placement = String(target?.dataset?.tooltipPlacement || settings.defaultPlacement || 'top').trim();
  if (placement === 'bottom' || placement === 'left' || placement === 'right') return placement;
  return 'top';
}

function getDelayForTarget(target) {
  const delayRaw = Number.parseInt(target?.dataset?.tooltipDelay || '', 10);
  if (Number.isFinite(delayRaw)) return Math.max(0, delayRaw);
  return Math.max(0, Number(settings.defaultDelay) || 0);
}

function isVisible() {
  return !!tooltipEl && tooltipEl.classList.contains('is-active');
}

function choosePlacement(preferred, targetRect, width, height) {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const canUse = {
    top: targetRect.top >= height + SPACING,
    bottom: viewportHeight - targetRect.bottom >= height + SPACING,
    left: targetRect.left >= width + SPACING,
    right: viewportWidth - targetRect.right >= width + SPACING,
  };

  if (canUse[preferred]) return preferred;
  if (preferred === 'top' && canUse.bottom) return 'bottom';
  if (preferred === 'bottom' && canUse.top) return 'top';
  if (preferred === 'left' && canUse.right) return 'right';
  if (preferred === 'right' && canUse.left) return 'left';
  if (canUse.top) return 'top';
  if (canUse.bottom) return 'bottom';
  if (canUse.right) return 'right';
  if (canUse.left) return 'left';
  return preferred;
}

function clamp(min, value, max) {
  return Math.min(max, Math.max(min, value));
}

function computePosition(targetRect, width, height, placement) {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = targetRect.left + (targetRect.width / 2) - (width / 2);
  let top = targetRect.top - height - SPACING;

  if (placement === 'bottom') {
    top = targetRect.bottom + SPACING;
  } else if (placement === 'left') {
    left = targetRect.left - width - SPACING;
    top = targetRect.top + (targetRect.height / 2) - (height / 2);
  } else if (placement === 'right') {
    left = targetRect.right + SPACING;
    top = targetRect.top + (targetRect.height / 2) - (height / 2);
  }

  const safeLeft = clamp(8, left, Math.max(8, viewportWidth - width - 8));
  const safeTop = clamp(8, top, Math.max(8, viewportHeight - height - 8));

  return { left: safeLeft, top: safeTop };
}

function renderTooltip(target) {
  const content = String(target?.dataset?.tooltip || '').trim();
  if (!content) return;

  const el = ensureTooltipElement();
  el.textContent = content;
  el.classList.remove('is-visible');
  el.classList.add('is-active');
  el.setAttribute('aria-hidden', 'false');

  const targetRect = target.getBoundingClientRect();
  const preferredPlacement = getPlacementForTarget(target);
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  const finalPlacement = choosePlacement(preferredPlacement, targetRect, width, height);
  const pos = computePosition(targetRect, width, height, finalPlacement);

  el.style.left = `${pos.left}px`;
  el.style.top = `${pos.top}px`;
  el.dataset.placement = finalPlacement;

  requestAnimationFrame(() => {
    if (activeTarget !== target) return;
    el.classList.add('is-visible');
  });
}

function showTooltip(target, mode = 'hover') {
  clearShowTimer();
  if (!target || !target.isConnected) return;

  const activate = () => {
    if (!target.isConnected) return;
    activeTarget = target;
    renderTooltip(target);
  };

  if (mode === 'focus') {
    activate();
    return;
  }

  showTimer = setTimeout(activate, getDelayForTarget(target));
}

function hideTooltip() {
  clearShowTimer();
  activeTarget = null;
  if (!tooltipEl) return;
  tooltipEl.classList.remove('is-visible');
  tooltipEl.classList.remove('is-active');
  tooltipEl.setAttribute('aria-hidden', 'true');
  delete tooltipEl.dataset.placement;
}

function getTooltipTarget(node) {
  if (!node || !(node instanceof Element)) return null;
  return node.closest(TOOLTIP_SELECTOR);
}

function handlePointerOver(event) {
  if (!supportsHoverInput()) return;
  const target = getTooltipTarget(event.target);
  if (!target) return;
  if (activeTarget === target || target.contains(activeTarget)) return;
  showTooltip(target, 'hover');
}

function handlePointerOut(event) {
  if (!supportsHoverInput()) return;
  const target = getTooltipTarget(event.target);
  if (!target) return;
  if (event.relatedTarget && target.contains(event.relatedTarget)) return;
  if (activeTarget === target || !isVisible()) {
    hideTooltip();
  } else {
    clearShowTimer();
  }
}

function handleFocusIn(event) {
  if (!lastInteractionWasKeyboard) return;
  const target = getTooltipTarget(event.target);
  if (!target) return;
  showTooltip(target, 'focus');
}

function handleFocusOut(event) {
  const target = getTooltipTarget(event.target);
  if (!target) return;
  if (event.relatedTarget && target.contains(event.relatedTarget)) return;
  if (activeTarget === target) {
    hideTooltip();
  }
}

function handleKeyDown(event) {
  if (!event.metaKey && !event.altKey && !event.ctrlKey) {
    lastInteractionWasKeyboard = true;
  }
  if (event.key === 'Escape') {
    hideTooltip();
  }
}

function handlePointerDown() {
  lastInteractionWasKeyboard = false;
  hideTooltip();
}

export function initTooltips(options = {}) {
  if (initialized) return;
  initialized = true;
  settings = {
    ...settings,
    ...options,
  };

  ensureTooltipElement();

  document.addEventListener('pointerover', handlePointerOver, true);
  document.addEventListener('pointerout', handlePointerOut, true);
  document.addEventListener('focusin', handleFocusIn, true);
  document.addEventListener('focusout', handleFocusOut, true);
  document.addEventListener('keydown', handleKeyDown, true);
  document.addEventListener('pointerdown', handlePointerDown, true);
  window.addEventListener('scroll', hideTooltip, true);
  window.addEventListener('resize', hideTooltip);
}
