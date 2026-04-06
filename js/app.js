/**
 * Ragnarok Craft Breakdown — App Logic
 *
 * Flow:
 *   1. Load data/items.json → build itemsMap (id → item)
 *   2. Search input → filter items → show dropdown
 *   3. User selects item → renderRecipePanel(item)
 *   4. renderRecipePanel builds an ingredient tree via renderIngredientTree()
 *   5. Each craftable ingredient row has a breakdown toggle button
 *   6. Each row has a have-counter (−, typed value, +) to deduct owned materials
 *   7. Toggle / have changes update state maps → re-render panel
 *
 * Quantity math:
 *   renderIngredientTree(ingredients, multiplier, depth, parentKey)
 *   → fullQty      = ingredient.qty * multiplier   (total required)
 *   → have         = haveState.get(rowKey) || 0
 *   → effectiveQty = max(0, fullQty - have)         (still needed)
 *   → sub-tree receives effectiveQty as its multiplier, so deductions propagate
 *
 * Row identity (shared by breakdownState and haveState):
 *   parentKey + '|' + itemId + '|' + index
 */

'use strict';

// ── State ──────────────────────────────────────────────────────────────────
let itemsMap = new Map();          // id → item object
let selectedItem = null;           // currently displayed item
const breakdownState = new Map();  // rowKey → boolean (expanded?)
const haveState = new Map();       // rowKey → number  (qty player already has)

// ── Bootstrap ──────────────────────────────────────────────────────────────
async function init() {
  try {
    const res = await fetch('data/items.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    for (const item of data.items) {
      itemsMap.set(item.id, item);
    }

    setupSearch();
  } catch (err) {
    document.body.insertAdjacentHTML(
      'afterbegin',
      `<div style="color:#e07070;padding:16px;text-align:center">
        Failed to load items.json: ${escapeHtml(err.message)}
       </div>`
    );
  }
}

// ── Search ─────────────────────────────────────────────────────────────────
function setupSearch() {
  const input   = document.getElementById('search-input');
  const results = document.getElementById('search-results');

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    renderSearchResults(q, results);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeResults(results);
      input.value = '';
      input.blur();
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrapper')) closeResults(results);
  });
}

function renderSearchResults(query, listEl) {
  listEl.innerHTML = '';

  if (!query) {
    listEl.classList.remove('visible');
    return;
  }

  const matches = [...itemsMap.values()].filter(item =>
    item.name.toLowerCase().includes(query) ||
    (item.category && item.category.toLowerCase().includes(query))
  );

  if (matches.length === 0) {
    listEl.innerHTML = '<li class="no-results">No items found</li>';
  } else {
    for (const item of matches) {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="item-name">${escapeHtml(item.name)}</span>
        ${item.category ? `<span class="item-category">${escapeHtml(item.category)}</span>` : ''}
      `;
      li.addEventListener('click', () => {
        selectItem(item, listEl);
      });
      listEl.appendChild(li);
    }
  }

  listEl.classList.add('visible');
}

function selectItem(item, listEl) {
  selectedItem = item;
  breakdownState.clear();
  haveState.clear();
  closeResults(listEl);
  document.getElementById('search-input').value = item.name;
  renderRecipePanel(item);
}

function closeResults(listEl) {
  listEl.classList.remove('visible');
  listEl.innerHTML = '';
}

// ── Recipe panel ───────────────────────────────────────────────────────────
function renderRecipePanel(item) {
  const panel = document.getElementById('recipe-panel');
  panel.innerHTML = '';
  panel.classList.add('visible');

  // Header
  const header = document.createElement('div');
  header.className = 'recipe-header';
  header.innerHTML = `
    <span class="item-title">${escapeHtml(item.name)}</span>
    ${item.category ? `<span class="item-cat-badge">${escapeHtml(item.category)}</span>` : ''}
    <span class="recipe-subtitle">${(item.craftable && item.recipe && item.recipe.length > 0) ? 'Craftable' : item.craftable ? 'Craftable (no recipe on file)' : 'Raw material'}</span>
  `;
  panel.appendChild(header);

  if (!item.craftable || !item.recipe || item.recipe.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'no-recipe-msg';
    msg.textContent = item.craftable ? 'No recipe available.' : 'This is a raw material — no recipe.';
    panel.appendChild(msg);
    return;
  }

  // Copy button
  const copyBar = document.createElement('div');
  copyBar.className = 'copy-bar';
  copyBar.innerHTML = `<button class="copy-btn" id="copy-btn">copy list</button>`;
  panel.appendChild(copyBar);

  document.getElementById('copy-btn').addEventListener('click', () => {
    const full = buildCopyText(item);
    navigator.clipboard.writeText(full).then(() => {
      const btn = document.getElementById('copy-btn');
      btn.textContent = 'copied!';
      setTimeout(() => { btn.textContent = 'copy list'; }, 1500);
    });
  });

  // Tree
  const treeEl = document.createElement('div');
  treeEl.className = 'ingredient-tree';
  renderIngredientTree(item.recipe, 1, 0, item.id, treeEl);
  panel.appendChild(treeEl);

  // Legend
  panel.insertAdjacentHTML('beforeend', `
    <div class="legend">
      <div class="legend-item">
        <span class="legend-dot craftable"></span> Craftable (can be broken down)
      </div>
      <div class="legend-item">
        <span class="legend-dot raw"></span> Raw material
      </div>
    </div>
  `);
}

/**
 * Renders a list of recipe ingredients into `containerEl`.
 *
 * @param {Array}       ingredients  Array of { itemId, qty }
 * @param {number}      multiplier   Accumulated quantity factor from parent levels
 * @param {number}      depth        Tree depth (0 = top-level)
 * @param {string}      parentKey    Unique key of the parent context (for row identity)
 * @param {HTMLElement} containerEl  Element to append rows into
 */
function renderIngredientTree(ingredients, multiplier, depth, parentKey, containerEl) {
  ingredients.forEach((ingredient, index) => {
    const rowKey      = `${parentKey}|${ingredient.itemId}|${index}`;
    const item        = itemsMap.get(ingredient.itemId);
    const fullQty     = ingredient.qty * multiplier;
    const have        = haveState.get(rowKey) || 0;
    const effectiveQty = Math.max(0, fullQty - have);
    const expanded    = breakdownState.get(rowKey) === true;
    const covered     = have > 0 && effectiveQty === 0;

    if (depth === 0 && index > 0) {
      const divider = document.createElement('hr');
      divider.className = 'ingredient-divider';
      containerEl.appendChild(divider);
    }

    const rowEl = document.createElement('div');
    rowEl.className = 'ingredient-row' + (covered ? ' is-covered' : '');
    rowEl.dataset.depth = depth;

    const isCraftable  = item && item.craftable && item.recipe && item.recipe.length > 0;
    const nameClass    = !item ? 'is-unknown' : isCraftable ? 'is-craftable' : 'is-raw';
    const displayName  = item ? escapeHtml(item.name) : escapeHtml(ingredient.itemId);
    const unknownBadge = !item ? '<span class="unknown-badge">?</span>' : '';
    const connector    = depth === 0 ? '◆' : '└─';

    rowEl.innerHTML = `
      <div class="ingredient-row-inner">
        <span class="tree-connector">${connector}</span>
        <span class="qty-badge${effectiveQty === 0 && have > 0 ? ' is-zero' : ''}">${formatQty(effectiveQty)}</span>
        <span class="ingredient-name ${nameClass}">${displayName}${unknownBadge}</span>
        ${isCraftable
          ? `<button class="breakdown-btn ${expanded ? 'expanded' : ''}" data-row-key="${escapeAttr(rowKey)}">
               ${expanded ? '▲ collapse' : '▼ breakdown'}
             </button>`
          : ''}
        <div class="have-counter" data-row-key="${escapeAttr(rowKey)}">
          <span class="have-label">have:</span>
          <button class="have-btn" data-action="minus" title="Remove one">−</button>
          <span class="have-val" title="Click to type">${have}</span>
          <button class="have-btn" data-action="plus" title="Add one">+</button>
        </div>
      </div>
    `;

    // Breakdown toggle
    if (isCraftable) {
      rowEl.querySelector('.breakdown-btn').addEventListener('click', () => {
        breakdownState.set(rowKey, !breakdownState.get(rowKey));
        renderRecipePanel(selectedItem);
      });
    }

    // Have counter — +/− buttons
    rowEl.querySelector('[data-action="minus"]').addEventListener('click', () => {
      const cur = haveState.get(rowKey) || 0;
      if (cur > 0) haveState.set(rowKey, cur - 1);
      renderRecipePanel(selectedItem);
    });

    rowEl.querySelector('[data-action="plus"]').addEventListener('click', () => {
      const cur = haveState.get(rowKey) || 0;
      haveState.set(rowKey, cur + 1);
      renderRecipePanel(selectedItem);
    });

    // Have counter — click to type
    rowEl.querySelector('.have-val').addEventListener('click', function () {
      const counter = this.closest('.have-counter');
      const cur = haveState.get(rowKey) || 0;

      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.value = cur;
      input.className = 'have-input';

      this.replaceWith(input);
      input.select();

      function commit() {
        const val = Math.max(0, parseInt(input.value, 10) || 0);
        haveState.set(rowKey, val);
        renderRecipePanel(selectedItem);
      }

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') renderRecipePanel(selectedItem);
      });
      input.addEventListener('blur', commit);
    });

    // Sub-tree — uses effectiveQty so deductions propagate
    if (isCraftable && expanded) {
      const subTree = document.createElement('div');
      subTree.className = 'sub-tree';
      renderIngredientTree(item.recipe, effectiveQty, depth + 1, rowKey, subTree);
      rowEl.appendChild(subTree);
    }

    containerEl.appendChild(rowEl);
  });
}

// ── Text tree builders (for clipboard) ────────────────────────────────────

/**
 * Returns true if any row in this ingredient tree has a have-value > 0.
 */
function hasAnyDeductions(ingredients, multiplier, parentKey) {
  return ingredients.some((ingredient, index) => {
    const rowKey = `${parentKey}|${ingredient.itemId}|${index}`;
    if ((haveState.get(rowKey) || 0) > 0) return true;
    const item = itemsMap.get(ingredient.itemId);
    if (item && item.craftable && item.recipe) {
      const qty = ingredient.qty * multiplier;
      return hasAnyDeductions(item.recipe, qty, rowKey);
    }
    return false;
  });
}

/**
 * Full-recipe tree: shows complete quantities regardless of haveState.
 * Annotates rows where the player has some with "(have N)".
 * Children always receive the full qty as multiplier (no deductions propagated).
 */
function buildFullTree(ingredients, multiplier, depth, parentKey) {
  const indent = '  '.repeat(depth);
  const lines = [];

  ingredients.forEach((ingredient, index) => {
    const rowKey  = `${parentKey}|${ingredient.itemId}|${index}`;
    const item    = itemsMap.get(ingredient.itemId);
    const fullQty = ingredient.qty * multiplier;
    const have    = haveState.get(rowKey) || 0;
    const expanded = breakdownState.get(rowKey) === true;

    const name        = item ? item.name : ingredient.itemId + ' (?)';
    const isCraftable = item && item.craftable && item.recipe && item.recipe.length > 0;
    const craftedNote = isCraftable ? ' [crafted]' : '';
    const haveNote    = have > 0 ? ` (have ${have})` : '';

    lines.push(`${indent}${formatQtyText(fullQty)} ${name}${craftedNote}${haveNote}`);

    if (isCraftable) {
      lines.push(buildFullTree(item.recipe, fullQty, depth + 1, rowKey));
    }
  });

  return lines.join('\n');
}

/**
 * Needed tree: shows effective quantities after haveState deductions.
 * Rows with effectiveQty === 0 (fully covered) are skipped entirely.
 * Children receive effectiveQty as multiplier so deductions propagate.
 */
function buildNeededTree(ingredients, multiplier, depth, parentKey) {
  const indent = '  '.repeat(depth);
  const lines = [];

  ingredients.forEach((ingredient, index) => {
    const rowKey       = `${parentKey}|${ingredient.itemId}|${index}`;
    const item         = itemsMap.get(ingredient.itemId);
    const fullQty      = ingredient.qty * multiplier;
    const have         = haveState.get(rowKey) || 0;
    const effectiveQty = Math.max(0, fullQty - have);
    const expanded     = breakdownState.get(rowKey) === true;

    if (effectiveQty === 0) return; // fully covered, skip

    const name        = item ? item.name : ingredient.itemId + ' (?)';
    const isCraftable = item && item.craftable && item.recipe && item.recipe.length > 0;
    const craftedNote = isCraftable ? ' [crafted]' : '';

    lines.push(`${indent}${formatQtyText(effectiveQty)} ${name}${craftedNote}`);

    if (isCraftable) {
      lines.push(buildNeededTree(item.recipe, effectiveQty, depth + 1, rowKey));
    }
  });

  return lines.filter(Boolean).join('\n');
}

/**
 * Entry point for copy. Returns one section when nothing is marked,
 * two sections (Recipe + Needed) when any have-deductions are active.
 */
function buildCopyText(item) {
  const hasDeductions = hasAnyDeductions(item.recipe, 1, item.id);

  if (!hasDeductions) {
    return `${item.name}\n${buildFullTree(item.recipe, 1, 0, item.id)}`;
  }

  const recipePart = `${item.name} - Recipe\n${buildFullTree(item.recipe, 1, 0, item.id)}`;
  const neededPart = `${item.name} - Needed\n${buildNeededTree(item.recipe, 1, 0, item.id)}`;
  return `${recipePart}\n\n${neededPart}`;
}

function formatQtyText(n) {
  return Number.isInteger(n) ? `${n}x` : `${n.toFixed(2)}x`;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function formatQty(n) {
  return Number.isInteger(n) ? `${n}×` : `${n.toFixed(2)}×`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}

// ── Entry ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
