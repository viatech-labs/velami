/* Живое демо на velami.pro: тот же detector.js, что в расширении, только правила, без модели. */
(function () {
  'use strict';
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
