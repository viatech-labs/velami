/* Живое демо на velami.pro: тот же detector.js, что в расширении, только правила, без модели. */
(function () {
  'use strict';
  var reveal = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && reveal.length) {
    document.documentElement.classList.add('js');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    reveal.forEach(function (n) { io.observe(n); });
  }

  /* Кнопки «написать в чат» открывают чат OMNIQ. У виджета нет своего метода для этого, поэтому нажимается его
     круглая кнопка. Если чат не загрузился, срабатывает обычная ссылка на почту. */
  document.addEventListener('click', function (e) {
    var link = e.target.closest && e.target.closest('[data-chat]');
    if (!link || !window.OmniqWidget) return;
    var bubble = Array.prototype.filter.call(document.body.children, function (n) {
      return n.tagName === 'BUTTON' && getComputedStyle(n).position === 'fixed';
    })[0];
    if (!bubble) return;
    e.preventDefault();
    var open = Array.prototype.some.call(document.body.children, function (n) {
      return n.tagName === 'DIV' && getComputedStyle(n).position === 'fixed' && getComputedStyle(n).display !== 'none' && n.querySelector('.omniq-w-input');
    });
    if (!open) bubble.click();
  });

  /* Кнопка «скопировать текст»: видна только там, где буфер доступен. */
  Array.prototype.forEach.call(document.querySelectorAll('[data-copy]'), function (btn) {
    var src = document.getElementById(btn.getAttribute('data-copy'));
    if (!src || !navigator.clipboard || !navigator.clipboard.writeText) return;
    var label = btn.textContent;
    btn.hidden = false;
    btn.addEventListener('click', function () {
      var text = Array.prototype.map.call(src.querySelectorAll('p'), function (p) { return p.textContent.replace(/\u00a0/g, ' '); }).join('\n\n');
      navigator.clipboard.writeText(text).then(function () {
        btn.textContent = btn.getAttribute('data-done');
        setTimeout(function () { btn.textContent = label; }, 1800);
      }, function () {});
    });
  });

  var root = document.getElementById('demo');
  if (!root || !window.PG) return;
  var input = document.getElementById('demo-in');
  var out = document.getElementById('demo-out');
  var found = document.getElementById('demo-found');
  var count = document.getElementById('demo-count');
  var labels = JSON.parse(root.getAttribute('data-labels') || '{}');
  var countText = root.getAttribute('data-count');
  var noneText = root.getAttribute('data-none');
  var esc = function (s) { return s.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };

  function render() {
    var r = window.PG.maskText(input.value, { vault: new window.PG.Vault() });
    out.innerHTML = esc(r.text).replace(/\[\[([A-Z_]+)_(\d+)\]\]/g, '<mark class="tok">[[$1_$2]]</mark>') || '&nbsp;';
    var seen = {};
    var chips = r.findings.filter(function (f) { if (seen[f.id]) return false; seen[f.id] = 1; return true; });
    found.innerHTML = chips.map(function (f) {
      return '<li><span>' + esc(labels[f.type] || f.type) + '</span><code>' + esc(f.token) + '</code></li>';
    }).join('');
    count.textContent = chips.length ? countText.replace('{n}', chips.length) : noneText;
    count.classList.toggle('on', chips.length > 0);
  }

  function fit() { input.style.height = 'auto'; input.style.height = input.scrollHeight + 'px'; }

  var timer;
  input.addEventListener('input', function () { fit(); clearTimeout(timer); timer = setTimeout(render, 90); });
  window.addEventListener('resize', fit);
  fit();
  render();
})();
