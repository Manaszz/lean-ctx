/**
 * One-time invitation shown once per campaign in the local dashboard.
 *
 * Campaign v2 asks how people actually use LeanCTX and keeps the SDK pointer.
 * The design-partner solicitation from v1 is gone: a cold "email us to roll
 * this out" in a local tool asks the reader for a commitment before we have
 * asked them anything, and it competed with the one question that is worth a
 * modal — what they use it for and what is missing.
 *
 * The storage key is versioned exactly so a new campaign reaches people who
 * dismissed the previous one; bumping it here is what makes v2 appear.
 *
 * Sending is deliberate and one-way: nothing leaves the machine until the
 * button is pressed, and the notice above it says where the answers go before
 * they go there. The same form lives permanently in Settings
 * (`cockpit-feedback`) for anyone who dismisses this and wants it later.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'leanctx_feedback_survey_v2';
  var MAX_ANSWER = 2000;
  var OVERLAY_ID = 'leanctxPartnerPromo';
  var previousFocus = null;
  var backgroundState = [];
  var blockingObserver = null;
  var openFrame = null;

  function readStorage(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function rememberDismissal() {
    try { localStorage.setItem(STORAGE_KEY, 'dismissed'); } catch (_) {}
  }

  function hasBlockingDialog() {
    var onboarding = document.getElementById('onboardOverlay');
    var ownOverlay = document.getElementById(OVERLAY_ID);
    var otherModal = Array.prototype.slice.call(document.querySelectorAll('[aria-modal="true"]'))
      .some(function (dialog) {
        return (!ownOverlay || !ownOverlay.contains(dialog)) && !dialog.closest('[hidden]');
      });
    return !!(
      document.getElementById('lctxTokenGate') ||
      document.querySelector('.tour-overlay') ||
      (onboarding && !onboarding.hidden) ||
      otherModal
    );
  }

  function shouldShow() {
    return readStorage(STORAGE_KEY) !== 'dismissed' &&
      readStorage('lctx_onboarded') === '1' &&
      !hasBlockingDialog();
  }

  function setBackgroundInert(overlay) {
    backgroundState = Array.prototype.slice.call(document.body.children)
      .filter(function (element) { return element !== overlay && element.tagName !== 'SCRIPT'; })
      .map(function (element) {
        var state = {
          element: element,
          hadInert: element.hasAttribute('inert'),
          ariaHidden: element.getAttribute('aria-hidden')
        };
        element.setAttribute('inert', '');
        element.setAttribute('aria-hidden', 'true');
        return state;
      });
  }

  function restoreBackground() {
    backgroundState.forEach(function (state) {
      if (!state.hadInert) state.element.removeAttribute('inert');
      if (state.ariaHidden === null) state.element.removeAttribute('aria-hidden');
      else state.element.setAttribute('aria-hidden', state.ariaHidden);
    });
    backgroundState = [];
  }

  function close(remember) {
    var overlay = document.getElementById(OVERLAY_ID);
    if (remember) rememberDismissal();
    if (!overlay) return;
    if (blockingObserver) blockingObserver.disconnect();
    blockingObserver = null;
    if (openFrame !== null) cancelAnimationFrame(openFrame);
    openFrame = null;
    document.removeEventListener('focusin', keepFocusInDialog, true);
    overlay.classList.remove('show');
    document.body.classList.remove('partner-promo-open');
    setTimeout(function () {
      overlay.remove();
      restoreBackground();
      if (!hasBlockingDialog() && previousFocus && typeof previousFocus.focus === 'function') {
        previousFocus.focus();
      }
      previousFocus = null;
    }, 180);
  }

  function dismiss() { close(true); }

  function focusableElements(dialog) {
    return Array.prototype.slice.call(
      dialog.querySelectorAll('a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])')
    );
  }

  function handleKeydown(event) {
    var overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      dismiss();
      return;
    }
    if (event.key !== 'Tab') return;
    var dialog = overlay.querySelector('[role="dialog"]');
    if (!dialog) return;
    var focusable = focusableElements(dialog);
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (!dialog.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function keepFocusInDialog(event) {
    var overlay = document.getElementById(OVERLAY_ID);
    if (!overlay || overlay.contains(event.target)) return;
    var dialog = overlay.querySelector('[role="dialog"]');
    var focusable = dialog ? focusableElements(dialog) : [];
    if (focusable.length) focusable[0].focus();
  }

  /* Three of the four are free text on purpose: a fixed list of features can
     only return the answers it already contains, and the point is to learn
     which use cases exist. Frequency is the one multiple choice, and it is what
     makes the free text groupable — "what is missing" from a daily user and
     from someone who installed it yesterday are different wishes. */
  var QUESTIONS = [
    { id: 'use_case', label: 'What do you use LeanCTX for?', rows: 2 },
    { id: 'likes_most', label: 'What do you like most about it?', rows: 2 },
    { id: 'wishes', label: 'What is missing?', rows: 2 }
  ];

  var FREQUENCIES = [
    { id: 'daily', label: 'Daily' },
    { id: 'weekly', label: 'Weekly' },
    { id: 'occasionally', label: 'Occasionally' },
    { id: 'new', label: 'Just started' }
  ];

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function questionFields() {
    return QUESTIONS.map(function (q) {
      return '<label class="promo-field">' +
        '<span class="promo-field-label">' + escapeHtml(q.label) + '</span>' +
        '<textarea id="promoFb-' + q.id + '" rows="' + q.rows + '" ' +
          'maxlength="' + MAX_ANSWER + '"></textarea>' +
        '</label>';
    }).join('');
  }

  function frequencyChips() {
    return FREQUENCIES.map(function (f) {
      return '<button type="button" class="promo-chip" data-freq="' + escapeHtml(f.id) + '" ' +
        'aria-pressed="false">' + escapeHtml(f.label) + '</button>';
    }).join('');
  }

  function createOverlay() {
    var overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'partner-promo-overlay';
    overlay.innerHTML =
      '<section class="partner-promo" role="dialog" aria-modal="true" ' +
        'aria-labelledby="partnerPromoTitle" aria-describedby="partnerPromoDescription">' +
        '<button type="button" class="partner-promo-close" aria-label="Dismiss">&times;</button>' +
        '<div class="partner-promo-kicker">HELP SHAPE LEANCTX</div>' +
        '<h2 id="partnerPromoTitle">How do you use LeanCTX?</h2>' +
        '<p id="partnerPromoDescription" class="partner-promo-intro">' +
          'Four questions, all optional. What you write here decides what gets built next.' +
        '</p>' +
        '<div class="promo-form">' +
          questionFields() +
          '<div class="promo-field">' +
            '<span class="promo-field-label">How often do you use it?</span>' +
            '<div class="promo-chips">' + frequencyChips() + '</div>' +
          '</div>' +
        '</div>' +
        /* Said before the button, not after: pressing send is the moment
           something leaves this machine. */
        '<p class="promo-note">Sending transmits these answers, your LeanCTX version and the ' +
          'anonymous installation id to leanctx.com. Nothing else, and nothing until you press it.</p>' +
        '<div class="promo-actions">' +
          '<button type="button" class="partner-promo-cta partner-promo-cta-primary" id="promoFbSend">' +
            'Send feedback</button>' +
          '<a class="partner-promo-cta" href="https://github.com/Thinkery-AG/leanctx-sdk#readme" ' +
            'target="_blank" rel="noopener noreferrer">Explore the SDK <span aria-hidden="true">&rarr;</span>' +
            '<span class="partner-promo-sr-only"> (opens in a new tab)</span></a>' +
        '</div>' +
        '<p class="promo-status" id="promoFbStatus" role="status" aria-live="polite"></p>' +
        '<button type="button" class="partner-promo-later">Not now</button>' +
      '</section>';
    return overlay;
  }

  function collectAnswers(overlay) {
    var body = {};
    QUESTIONS.forEach(function (q) {
      var el = overlay.querySelector('#promoFb-' + q.id);
      body[q.id] = el ? el.value : '';
    });
    var active = overlay.querySelector('.promo-chip[aria-pressed="true"]');
    body.frequency = active ? active.getAttribute('data-freq') : '';
    return body;
  }

  function wireForm(overlay) {
    overlay.querySelectorAll('.promo-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var on = chip.getAttribute('aria-pressed') === 'true';
        overlay.querySelectorAll('.promo-chip').forEach(function (other) {
          other.setAttribute('aria-pressed', 'false');
        });
        // Clicking the active choice clears it: the question is optional and
        // there is otherwise no way back to "I would rather not say".
        chip.setAttribute('aria-pressed', on ? 'false' : 'true');
      });
    });

    var send = overlay.querySelector('#promoFbSend');
    var status = overlay.querySelector('#promoFbStatus');
    if (!send || !status) return;

    send.addEventListener('click', async function () {
      var body = collectAnswers(overlay);
      var answered = ['use_case', 'likes_most', 'wishes'].some(function (id) {
        return String(body[id] || '').trim() !== '';
      });
      if (!answered) {
        status.textContent = 'Answer at least one question before sending.';
        status.className = 'promo-status is-error';
        return;
      }

      var apiFetch = window.LctxApi && window.LctxApi.apiFetch;
      if (!apiFetch) {
        status.textContent = 'Dashboard API unavailable — reload the page.';
        status.className = 'promo-status is-error';
        return;
      }

      send.disabled = true;
      status.textContent = 'Sending…';
      status.className = 'promo-status';
      try {
        var res = await apiFetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        var data = null;
        try { data = await res.json(); } catch (_) { data = null; }
        if (res && res.ok) {
          // Only a successful send counts as done — a failed one must not
          // burn the campaign and lose what was typed.
          status.textContent = 'Sent — thank you.';
          status.className = 'promo-status is-ok';
          setTimeout(function () { dismiss(); }, 1200);
          return;
        }
        status.textContent = 'Not sent: ' + ((data && (data.error || data.message)) || 'the server refused it');
        status.className = 'promo-status is-error';
      } catch (e) {
        status.textContent = 'Not sent: ' + (e && e.message ? e.message : 'network error');
        status.className = 'promo-status is-error';
      } finally {
        send.disabled = false;
      }
    });
  }

  function show() {
    if (!shouldShow() || document.getElementById(OVERLAY_ID)) return false;
    previousFocus = document.activeElement;
    var overlay = createOverlay();
    document.body.appendChild(overlay);
    setBackgroundInert(overlay);
    document.body.classList.add('partner-promo-open');

    overlay.querySelector('.partner-promo-close').addEventListener('click', dismiss);
    overlay.querySelector('.partner-promo-later').addEventListener('click', dismiss);
    // Only the outbound SDK link dismisses on click. The send button must not:
    // it dismisses itself after a *successful* send, so a failed one keeps the
    // dialog and the text the person just typed.
    overlay.querySelectorAll('a.partner-promo-cta').forEach(function (link) {
      link.addEventListener('click', dismiss);
    });
    wireForm(overlay);
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) dismiss();
    });
    overlay.addEventListener('keydown', handleKeydown);
    document.addEventListener('focusin', keepFocusInDialog, true);
    if (typeof MutationObserver !== 'undefined') {
      blockingObserver = new MutationObserver(function () {
        if (hasBlockingDialog()) close(false);
      });
      blockingObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'hidden']
      });
    }

    openFrame = requestAnimationFrame(function () {
      openFrame = null;
      if (document.getElementById(OVERLAY_ID) !== overlay) return;
      overlay.classList.add('show');
      overlay.querySelector('.partner-promo-close').focus();
    });
    return true;
  }

  function autoStart() {
    setTimeout(show, 1200);
  }

  window.__leanctxPartnerPromo = {
    dismiss: dismiss,
    shouldShow: shouldShow,
    show: show,
    storageKey: STORAGE_KEY
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoStart, { once: true });
  } else {
    autoStart();
  }
})();
